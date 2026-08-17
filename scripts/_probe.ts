import './load-env';
import { closeMongo, generate } from '@grasp/core';
try {
  const r = await generate({
    task: 'card.generate',
    input: { text: 'Sine is opposite over hypotenuse. Cosine is adjacent over hypotenuse.', concepts: 'trig-ratios', objectives: '', stageRange: '9-11', count: 1 },
  });
  console.log('OK:', JSON.stringify(r.data).slice(0, 240));
} catch (e) {
  console.log('ERR:', (e as Error).message.slice(0, 700));
}
await closeMongo();
