// Testa o controller com um Prisma falso em memória (sem banco)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const cenarios = [];
const imovel = {
  id: 1, usuarioId: 7, endereco: 'Rua A', cidade: 'Curitiba', uf: 'PR',
  eletrodomesticos: [{ potenciaW: 1000, quantidade: 1, horasDia: 10 }] // 300 kWh/mês
};
const fakePrisma = {
  imovel: { findFirst: async ({ where }) => (where.id === 1 && where.usuarioId === 7 ? imovel : null) },
  consumoHistorico: { findMany: async () => [] },
  cenarioDimensionamento: {
    create: async ({ data }) => {
      const { logs, ...resto } = data;
      const c = { id: cenarios.length + 1, ...resto, logs: logs.create };
      cenarios.push(c);
      return c;
    },
    findFirst: async ({ where }) =>
      cenarios.find((c) => c.id === where.id && c.imovelId === where.imovelId && where.imovel.usuarioId === 7) || null,
    update: async ({ where, data }) => {
      const c = cenarios.find((x) => x.id === where.id);
      const { logs, ...resto } = data;
      Object.assign(c, resto);
      c.logs.push(...logs.create);
      return c;
    }
  }
};
require.cache[require.resolve('../prisma/client')] = {
  id: 'x', filename: 'x', loaded: true, exports: fakePrisma
};
const ctrl = require('../controllers/dimensionamentoController');

function chamar(fn, { params = { id: '1' }, body = {}, query = {}, usuarioId = 7 } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); }
    };
    fn({ params, body, query, usuarioId }, res);
  });
}

test('criar: HSP da UF + E_FV + log (PB03/PB04)', async () => {
  const r = await chamar(ctrl.criar, { body: { percentualAtendimento: 80 } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.consumoReferenciaKwh, 300);
  assert.strictEqual(r.body.hspOrigem, 'tabela');
  assert.strictEqual(r.body.hspKwhM2Dia, 4.7); // PR
  assert.ok(r.body.hspFonte.includes('INPE'));
  assert.strictEqual(r.body.energiaMensalFvKwh, 240);
  assert.strictEqual(r.body.logs[0].formula, 'E_FV = C_m × f');
});

test('criar: HSP manual fora da faixa é rejeitado', async () => {
  const r = await chamar(ctrl.criar, { body: { hspKwhM2Dia: 8 } });
  assert.strictEqual(r.status, 400);
});

test('atualizar: recalcula E_FV ao mudar percentual e consumo, e grava novo log', async () => {
  let r = await chamar(ctrl.atualizar, { params: { id: '1', cenarioId: '1' }, body: { percentualAtendimento: 50 } });
  assert.strictEqual(r.body.energiaMensalFvKwh, 150);
  r = await chamar(ctrl.atualizar, { params: { id: '1', cenarioId: '1' }, body: { consumoReferenciaKwh: 500 } });
  assert.strictEqual(r.body.energiaMensalFvKwh, 250);
  assert.strictEqual(cenarios[0].logs.length, 3);
});

test('atualizar: mudar UF troca o HSP da tabela; manual é preservado', async () => {
  let r = await chamar(ctrl.atualizar, { params: { id: '1', cenarioId: '1' }, body: { uf: 'PI' } });
  assert.strictEqual(r.body.hspKwhM2Dia, 5.7);
  r = await chamar(ctrl.atualizar, { params: { id: '1', cenarioId: '1' }, body: { hspKwhM2Dia: 4.2 } });
  assert.strictEqual(r.body.hspOrigem, 'manual');
  r = await chamar(ctrl.atualizar, { params: { id: '1', cenarioId: '1' }, body: { uf: 'SC' } });
  assert.strictEqual(r.body.hspKwhM2Dia, 4.2); // manual mantido
  r = await chamar(ctrl.atualizar, { params: { id: '1', cenarioId: '1' }, body: { usarHspTabela: true } });
  assert.strictEqual(r.body.hspOrigem, 'tabela');
  assert.strictEqual(r.body.hspKwhM2Dia, 4.5);
});

test('consultarHsp: por UF, tabela completa e UF inexistente', async () => {
  assert.strictEqual((await chamar(ctrl.consultarHsp, { query: { uf: 'sp' } })).body.hsp, 5.1);
  assert.strictEqual((await chamar(ctrl.consultarHsp)).body.tabela.length, 27);
  assert.strictEqual((await chamar(ctrl.consultarHsp, { query: { uf: 'ZZ' } })).status, 404);
});

test('privacidade: outro usuário não acessa o cenário', async () => {
  const r = await chamar(ctrl.obter, { params: { id: '1', cenarioId: '1' }, usuarioId: 99 });
  assert.strictEqual(r.status, 404);
});
