const test = require('node:test');
const assert = require('node:assert');
const {
  validarAutonomia,
  resolverArmazenamento,
  custoBateria
} = require('../services/armazenamento');

test('autonomia: aceita 1 a 72 h, inclusive texto com vírgula', () => {
  assert.strictEqual(validarAutonomia(1).valor, 1);
  assert.strictEqual(validarAutonomia(72).valor, 72);
  assert.strictEqual(validarAutonomia('12,5').valor, 12.5);
});

test('autonomia: rejeita não positivos, fora da faixa e não numéricos', () => {
  for (const v of [0, -3, 0.5, 73, 'abc']) assert.ok(validarAutonomia(v).erro, `deveria rejeitar ${v}`);
});

test('armazenamento: padrão é sem baterias, sem autonomia', () => {
  assert.deepStrictEqual(resolverArmazenamento({}), { armazenamento: false, autonomiaHoras: null });
});

test('armazenamento: sem baterias descarta a autonomia enviada', () => {
  const r = resolverArmazenamento({ armazenamento: false, autonomiaHoras: 24 });
  assert.deepStrictEqual(r, { armazenamento: false, autonomiaHoras: null });
});

test('armazenamento: com baterias exige autonomia válida', () => {
  assert.match(resolverArmazenamento({ armazenamento: true }).erro, /obrigatória/);
  assert.ok(resolverArmazenamento({ armazenamento: true, autonomiaHoras: 0 }).erro);
  assert.ok(resolverArmazenamento({ armazenamento: true, autonomiaHoras: 100 }).erro);
  assert.deepStrictEqual(resolverArmazenamento({ armazenamento: true, autonomiaHoras: '24' }), {
    armazenamento: true,
    autonomiaHoras: 24
  });
});

test('armazenamento: valor que não é booleano é rejeitado', () => {
  for (const v of ['com', 'sim', 1, 0]) assert.ok(resolverArmazenamento({ armazenamento: v }).erro, `deveria rejeitar ${v}`);
});

test('custo de bateria: zero sem armazenamento, valor calculado com armazenamento', () => {
  assert.strictEqual(custoBateria(false, 5000), 0);
  assert.strictEqual(custoBateria(false), 0);
  assert.strictEqual(custoBateria(true, 5000), 5000);
  assert.strictEqual(custoBateria(true), 0);
});
