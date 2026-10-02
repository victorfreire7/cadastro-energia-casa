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

test('criar: calcula P_FV com η=0,8 e D=30 padrão e grava log (PB05)', async () => {
  const r = await chamar(ctrl.criar, { body: { percentualAtendimento: 80 } });
  assert.strictEqual(r.status, 201);
  // E_FV = 240 kWh/mês; HSP (PR) = 4,7 → 240 / (4,7 × 30 × 0,8) = 2,128 kWp
  assert.strictEqual(r.body.fatorDesempenho, 0.8);
  assert.strictEqual(r.body.diasConsiderados, 30);
  assert.strictEqual(r.body.potenciaFvKwp, 2.128);
  const log = r.body.logs.find((l) => l.etapa === 'P_FV');
  assert.strictEqual(log.formula, 'P_FV = E_FV / (HSP × D × η)');
  assert.strictEqual(log.unidade, 'kWp');
  assert.strictEqual(log.resultado, 2.128);
  assert.deepStrictEqual(log.entradas, { E_FV_kWh_mes: 240, HSP_h_dia: 4.7, D_dias: 30, eta: 0.8 });
  cenarios.pop(); // não interfere nos testes que dependem de cenarios[0]
});

test('criar: η e D ajustados pelo usuário avançado; inválidos são rejeitados (PB05)', async () => {
  let r = await chamar(ctrl.criar, { body: { percentualAtendimento: 100, fatorDesempenho: 0.75, diasConsiderados: 31 } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.potenciaFvKwp, Number((300 / (4.7 * 31 * 0.75)).toFixed(3)));
  cenarios.pop();

  for (const body of [{ fatorDesempenho: 0 }, { fatorDesempenho: 1.5 }, { fatorDesempenho: 'abc' }, { diasConsiderados: 0 }, { diasConsiderados: 45 }, { diasConsiderados: 30.5 }]) {
    r = await chamar(ctrl.criar, { body });
    assert.strictEqual(r.status, 400, `deveria rejeitar ${JSON.stringify(body)}`);
  }
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
  // cada (re)cálculo grava os 4 logs (E_FV, P_FV, N_MODULOS, P_INSTALADA): criação + 2 atualizações
  assert.strictEqual(cenarios[0].logs.length, 12);
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

test('atualizar: recalcula P_FV ao mudar η, D, HSP, consumo ou percentual (PB05)', async () => {
  const params = { id: '1', cenarioId: '1' };
  let r = await chamar(ctrl.atualizar, { params, body: { usarHspTabela: true, uf: 'PR', percentualAtendimento: 100, consumoReferenciaKwh: 300 } });
  const base = r.body.potenciaFvKwp;
  assert.strictEqual(base, Number((300 / (4.7 * 30 * 0.8)).toFixed(3)));

  r = await chamar(ctrl.atualizar, { params, body: { fatorDesempenho: 0.7 } });
  assert.strictEqual(r.body.potenciaFvKwp, Number((300 / (4.7 * 30 * 0.7)).toFixed(3)));
  assert.ok(r.body.potenciaFvKwp > base); // η menor → mais potência

  r = await chamar(ctrl.atualizar, { params, body: { fatorDesempenho: 0.8, hspKwhM2Dia: 5 } });
  assert.strictEqual(r.body.potenciaFvKwp, Number((300 / (5 * 30 * 0.8)).toFixed(3)));

  r = await chamar(ctrl.atualizar, { params, body: { fatorDesempenho: 2 } });
  assert.strictEqual(r.status, 400);
});

test('paineis: lista o dataset e consulta por id (PB06)', async () => {
  const lista = await chamar(ctrl.consultarPaineis);
  assert.ok(lista.body.length >= 3);
  const um = await chamar(ctrl.consultarPainel, { params: { id: '1' } });
  assert.strictEqual(um.body.id, 1);
  assert.ok(um.body.fonte.length > 0);
  assert.strictEqual((await chamar(ctrl.consultarPainel, { params: { id: '999' } })).status, 404);
});

test('criar: seleciona módulo automático, calcula N e P_instalada e persiste (PB07/PB08)', async () => {
  const r = await chamar(ctrl.criar, { body: { percentualAtendimento: 80 } });
  assert.strictEqual(r.status, 201);
  // P_FV = 2,128 kWp → 4 módulos de 550 Wp = 2,2 kWp (mais barato: id 2)
  assert.strictEqual(r.body.moduloId, 2);
  assert.strictEqual(r.body.moduloModelo, 'Tiger Pro JKM550M-72HL4-V');
  assert.strictEqual(r.body.quantidadeModulos, 4);
  assert.strictEqual(r.body.potenciaInstaladaKwp, 2.2);
  assert.strictEqual(r.body.comparacaoPotencia.status, 'ok');
  assert.deepStrictEqual(r.body.logs.map((l) => l.etapa), ['E_FV', 'P_FV', 'N_MODULOS', 'P_INSTALADA']);
  cenarios.pop();
});

test('criar: módulo escolhido manualmente; inexistente/ inválido é rejeitado (PB07)', async () => {
  let r = await chamar(ctrl.criar, { body: { percentualAtendimento: 80, moduloId: 4 } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.moduloId, 4);
  assert.strictEqual(r.body.moduloPotenciaWp, 575);
  assert.strictEqual(r.body.quantidadeModulos, 4); // 2128/575 = 3,7 → 4
  assert.strictEqual(r.body.potenciaInstaladaKwp, 2.3);
  cenarios.pop();

  const antes = cenarios.length;
  for (const moduloId of [999, 'abc', -1]) {
    r = await chamar(ctrl.criar, { body: { moduloId } });
    assert.strictEqual(r.status, 400, String(moduloId));
  }
  assert.strictEqual(cenarios.length, antes); // nada foi salvo
});

test('criar: sistema pequeno gera alerta de folga (PB08)', async () => {
  const r = await chamar(ctrl.criar, { body: { consumoReferenciaKwh: 60, percentualAtendimento: 50 } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.quantidadeModulos, 1);
  assert.strictEqual(r.body.comparacaoPotencia.status, 'folga');
  assert.ok(r.body.comparacaoPotencia.mensagem);
  cenarios.pop();
});

test('atualizar: recalcula N e P_instalada ao mudar consumo; troca e mantém o módulo (PB07/PB08)', async () => {
  const params = { id: '1', cenarioId: '1' };
  await chamar(ctrl.atualizar, { params, body: { usarHspTabela: true, uf: 'PR', consumoReferenciaKwh: 300, percentualAtendimento: 100, fatorDesempenho: 0.8, diasConsiderados: 30 } });
  let r = await chamar(ctrl.atualizar, { params, body: { moduloId: 4 } });
  assert.strictEqual(r.body.moduloId, 4);
  const n300 = r.body.quantidadeModulos;

  r = await chamar(ctrl.atualizar, { params, body: { consumoReferenciaKwh: 900 } });
  assert.strictEqual(r.body.moduloId, 4); // módulo preservado
  assert.ok(r.body.quantidadeModulos > n300);
  assert.strictEqual(r.body.potenciaInstaladaKwp, (r.body.quantidadeModulos * 575) / 1000);

  r = await chamar(ctrl.atualizar, { params, body: { moduloId: 999 } });
  assert.strictEqual(r.status, 400);
});

test('consultarModulos: opções calculadas para um P_FV; entrada inválida é 400 (PB07)', async () => {
  const r = await chamar(ctrl.consultarModulos, { query: { potenciaFvKwp: '2,128' } });
  assert.strictEqual(r.body.padraoId, 2);
  assert.strictEqual(r.body.opcoes.length, 4);
  for (const q of [{}, { potenciaFvKwp: '0' }, { potenciaFvKwp: 'abc' }]) {
    assert.strictEqual((await chamar(ctrl.consultarModulos, { query: q })).status, 400);
  }
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
