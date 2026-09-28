---
name: spark-training
description: Build and run a bounded ChatSOP GPU training job with rootless Podman on DGX Spark
---

# DGX Spark: explicit rootless Podman training

This is an operational procedure, not evidence that a particular image or
training run succeeded. The only trainer is `node training/cli.mjs` in the
repository; `training/container/podman.mjs` supplies an image build and
bounded container transport. Review `probably_obsolete/legacy/requirements/08-spark.md`
and `27-date-si-invatare-v3.md` as **historical requirements**, not active
launch commands. Do not invoke an imported shell launcher or use Docker.

**Current operator gate:** do not invoke `train`, `--resume`, fine-tuning,
optimizer steps or a training smoke run until the user gives a **new explicit
approval**. Image build, image dependency setup, CUDA infrastructure
preflight, dataset qualification and safe container stop may proceed; none
of those qualifies as permission to train. The commands in sections 4–5
are a future procedure, not authorization to execute them now.

## 1. Confirm ownership and prerequisites

Work from the ChatSOP root on the intended ARM64 machine. Confirm the
reviewed corpus, model license and pinned base revision, verified token
lengths and SOP targets. Keep a separate new job name for each preflight
and each train attempt. Inspect `models/.training.lock/owner.json` and
`models/.container-runs/` for a living native or container job; do not
override the lock. Read `node training/cli.mjs --help`. Inspect:

```sh
podman version
podman info
nvidia-ctk cdi list
nvidia-smi
cat /proc/meminfo
df -h .
```

Use **rootless** Podman and inspect cgroups v2, systemd delegation of CPU,
memory and PIDs, available host RAM, available disk, GPU consumers and CDI
device `nvidia.com/gpu=all`. Do not request `sudo`, mutate drivers, host
packages or sibling project environments. The observed 2026-09-27 example
host had Ubuntu 24.04 ARM64, Podman 5.8.6, crun 1.29.1, 20 CPUs, about
119.6 GiB RAM, no swap, and NVIDIA GB10 driver 580.159.03. Its native
reviewed Python imported torch 2.14.0+cu130 (CUDA 13), transformers 5.17.0,
peft 0.21.0 and accelerate 1.15.0; it is **not** a portable default or a
dependency mount for the image.

## 2. Explicit image build and provenance

The `Containerfile` pins ARM64 manifest digests of the CUDA 13.0.2
development base and Node 22.23.2, installs Python 3.12 development headers
in-image, then official ARM64 cu130 torch and exact Python versions in
`training/container/requirements.lock`. `docker.io` in a source reference
is an OCI registry address, not a Docker engine dependency. An image build
uses the network (`--pull=always`) but no GPU, refuses an active training
lock or insufficient host RAM/disk, and requests one build job, 16 GiB
memory with zero swap and four CPUs. Review base/package licenses and
registry/index changes before invoking it:

```sh
node training/container/podman.mjs build
podman image inspect localhost/chatsop-spark-training:cu130-20260927
```

The helper records the resulting local image ID, available digest, base
digests and build time in
`models/.container-runs/image-provenance.json`. Reuse that exact locally
inspected image ID; runtime uses `--pull=never` and never installs packages
or fetches weights. A pinned manifest/version list does not pin wheel bytes
by hash; publishing the image still requires upstream license/notices and
final dependency provenance review.

**Measured local build (2026-09-27):** the explicit Podman build succeeded,
producing image ID `36259551b3a1aa8f66532e310243c1ad23e2cc702ffcf0a77e1157515410463c`
and local digest `sha256:9c1dd2ab8101bc85d861e9952b6555ee43546a5562f27d312e8c46249ffc4383`.
This is an observed artifact, not a portable tag guarantee; inspect
`models/.container-runs/image-provenance.json` on each host before reuse.

## 3. Qualify before a real run

Check the reviewed base exists under `models/<model>/bases/<40hex>/`,
the immutable dataset manifest is validated and its rights are resolved.
Weights are obtained only by the separately approved explicit
`node training/cli.mjs download --model qwen` operation, not by training
startup. The helper refuses a missing local image, an existing training
lock, less than 48 GiB host `MemAvailable` or 40 GiB free disk. Its
container uses CDI, network isolation, read-only repository code/datasets,
writable `models/` and `eval/reports/current/`, per-job cache under
`models/.container-runs/<job>/`. It requests six CPUs, 32 GiB cgroup RAM
and zero swap, 256 PIDs, 1 GiB shared memory and a private 2 GiB temporary
filesystem; only the observed effective limits establish enforcement.
The child verifies effective cgroup CPU/memory/swap/PID/shm limits and a
48 GiB free CUDA floor before entering the same Node controller. The
controller separately requires 48 GiB CUDA-driver-reported free memory
and 48 GiB host available RAM at launch; it monitors disk/host pressure
and stops only its owned child group below the configured 16 GiB host
available or 16 GiB disk stop floors. The Podman supervisor additionally
checks host memory (<16 GiB) and disk (<20 GiB) every 30 seconds and stops
only its identified container at the wall deadline. These conservative
guards do not guarantee that a 32 GiB cgroup bounds unified-memory device
allocations:

```sh
node training/container/podman.mjs run --job qwen-preflight-01 --wall-minutes 15 -- preflight
node training/container/podman.mjs status --job qwen-preflight-01
```

The preflight's PyTorch BF16 forward/backward exercises CUDA; read
`models/.container-runs/qwen-preflight-01/inside-cgroups.json`,
`container.log`, `result.json` and `diagnostic.json` for effective cgroup
values, GPU observations and the actual outcome. Read `runtime-refusal.json`
if the supervisor had to stop the job. A CLI dry-run
does not exercise Python/GPU. A synthetic fixture, import or image build
cannot establish an actual training throughput or resource safety limit.
Only proceed after checking the successful preflight, image ID and the
container's printed effective cgroup values on **this** host. The helper
does not yet constitute measured evidence that device allocations/cache
remain bounded by `memory.max`.

**Measured local infrastructure preflight (2026-09-27):**
`spark-preflight-1` exited 0 with `oomKilled=false`, network `none` and
private IPC. Its `inside-cgroups.json` reports `cpu.max=600000 100000`,
`memory.max=34359738368`, `memory.swap.max=0`, `pids.max=256` and
`/dev/shm=1073741824` bytes. Its `container.log` reports NVIDIA GB10
SM 12.1, CUDA 13.0, torch 2.14.0+cu130, BF16 forward/backward passed,
CUDA free 99.22 GiB before and 98.55 GiB after, and PyTorch peak
allocation 67,699,200 bytes. These are one small CUDA infrastructure
probe, **not** model training, an optimizer step, a cache pressure test,
a controlled stop, or evidence that GPU allocations respect `memory.max`.
The current user approval gate above still blocks all training.

**Measured owned-stop probe (2026-09-27):** `spark-stop-probe-1`
ran `preflight --hold-seconds 60` with a two-minute wall limit. This option
holds the small CUDA infrastructure context for at most 300 seconds after
the forward/backward probe; it performs **zero optimizer steps**. While it
held the context, a second job was refused by the existing training lock.
`stop --job spark-stop-probe-1` stopped only its recorded container,
`37a9e31b6b801bafcf2326e6e03e3ba55caa802ca75a074ec05b5609ba68b55c`.
The result recorded `operator_requested`, exit code 1 and `oomKilled=false`;
exit 1 here is an intentional interruption, not a completed training run.
The owned lock was released. A fresh native CUDA context measured 99.93 GiB
free after stop, versus 99.07 GiB while the container probe held its context.
After that measurement exited, `nvidia-smi --query-compute-apps` listed no
compute processes. These observations establish cleanup of this small
owned job, **not** safety under sustained training or cache pressure.
Evidence remains under `models/.container-runs/spark-stop-probe-1/`.

## 4. Run once, watch and stop only owned work

Review the finite epoch/step budget and checkpoint cadence in `config/train-qwen.json`
and ensure disk headroom for a complete save. Run the same controller:

```sh
node training/container/podman.mjs run --job qwen-train-01 --wall-minutes 60 -- train --model qwen --run <new-run> --role formalizer --data <reviewed-dataset> --qualification <qualification.json> --authorization <new-user-authorization.json> --max-steps <reviewed-step-budget>
node training/container/podman.mjs status --job qwen-train-01
node training/container/podman.mjs stop --job qwen-train-01
```

`run` is a foreground supervisor of a detached, specifically labeled
container; in another terminal `status` and `stop` inspect the saved exact
container ID and label. Set an explicit wall time (1–1440 minutes) appropriate
to the reviewed finite step budget; expiry stops the owned container, not a
generic worker. Stop requests a bounded 90-second Podman stop; the
controller handles SIGTERM/SIGINT for its **owned** Python child group.
Wait for the run helper to record `result.json`, `diagnostic.json` and
`container.log`; check `podman inspect <saved-cid>` and `nvidia-smi` for
exit/OOM and GPU-memory release. If a stop times out, inspect the exact
container and lock before acting manually; never use generic `pkill`,
remove a live lock, run unbounded retries, restart the driver, squeeze the
cache or invoke `drop_caches`.

## 5. Diagnose and resume safely

On a running container, use its saved ID from
`models/.container-runs/<job>/cid` to inspect
`podman exec <saved-cid> cat /sys/fs/cgroup/memory.current
/sys/fs/cgroup/memory.events` (or inspect each file separately). Check
`oom`/`oom_kill`, CPU quota and PID counters alongside host
`MemAvailable`, CUDA free memory, filesystem space and Podman exit/OOM
state. GB10 shares host RAM between CPU/cache and GPU: the two reported
free-memory figures overlap and cannot be summed, and cgroup memory limits
do not necessarily limit driver/device allocations. Stop on persistent
pressure, diagnose competing consumers; make a new explicit run decision,
not an automatic restart. Record device/cache readings rather than claiming
container creation fixed the previous hang.

Retain `models/<model>/<run>/<role>/identity.json`, complete `latest/`
(digests plus optimizer/RNG), selected `best/`, `semantic/` reports and
`summary.json`. For an interrupted run, after the owned container has
exited and its lock is released, resume under a **new container job name**
with the **same** training run identity and `--resume`:

```sh
node training/container/podman.mjs run --job qwen-resume-01 --wall-minutes 60 -- train --model qwen --run <same-run> --role formalizer --data <same-reviewed-dataset> --qualification <qualification.json> --authorization <matching-user-authorization.json> --max-steps <same-step-budget> --resume
```

The controller must reject a mismatched/incomplete checkpoint. Keep the
semantic winner and reports even if the latest save is interrupted. Formalizer
`best` is full-dev execution equivalence with syntax as tiebreak; verbalizer
dev-loss alone is not a faithful-answer guarantee. Independently evaluate
the winner on sealed holdout and report counts, not just a loss curve.
