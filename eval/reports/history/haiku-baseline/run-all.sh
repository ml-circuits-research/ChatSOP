#!/bin/sh
# Primary haiku-nothink on all three sets first, then the secondary haiku-thinking.
cd "$(dirname "$0")"
sh ./run-nothink.sh
sh ./run-thinking-rest.sh
