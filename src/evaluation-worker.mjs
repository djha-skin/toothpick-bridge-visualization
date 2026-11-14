import { createTopology } from './bridge.mjs';
import { evaluatePopulation } from './genetics.mjs';

self.addEventListener('message', event => {
  const { id, population, topology: topologyConfig } = event.data;
  try {
    const topology = createTopology(topologyConfig);
    const genomes = population.map(genes => new Uint8Array(genes));
    const evaluations = evaluatePopulation(genomes, topology);
    self.postMessage({ id, evaluations });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
