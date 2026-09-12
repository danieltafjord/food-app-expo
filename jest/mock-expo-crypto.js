// Deterministic but unique ids: tests that create several rows need distinct keys.
let counter = 0;
module.exports = {
  randomUUID: () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  },
};
