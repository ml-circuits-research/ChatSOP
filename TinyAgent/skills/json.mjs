// Built-in skill: one call whose answer is a JSON object (extraction of a few fields, a classification with a reason).
export default {
  name: 'json',
  description: 'Ask one model tier for one JSON object (a few extracted fields, a classification with a reason) from a short instruction and optional short attachments.',
  inputs: {
    prompt: {type: 'string', min: 1, max: 20000, description: 'the instruction, naming the JSON fields wanted'},
    tier: {type: 'string', enum: ['nano', 'micro', 'tiny', 'small', 'medium', 'good'], default: 'small', description: 'the model tier'},
  },
  async run(ctx) {
    const texts = [];
    for (const a of ctx.attachments) texts.push(`=== ${a.name} ===\n${(await ctx.readAttachment(a.name)).slice(0, 60000)}`);
    const r = await ctx.ta.json({tier: ctx.inputs.tier, system: 'Answer with one JSON object only.', prompt: [ctx.inputs.prompt, ...texts].join('\n\n'), maxTokens: 4000, temperature: 0, retryCut: true});
    if (!r.ok) return {status: 'failed', summary: `no JSON from ${ctx.inputs.tier}: ${r.reason}`};
    return {status: 'finished', summary: JSON.stringify(r.json).slice(0, 2000), json: r.json};
  },
};
