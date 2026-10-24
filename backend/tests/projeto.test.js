// PB19/PB20/PB21 — motor integrado do projeto, persistência e proposta
const test = require('node:test');
const assert = require('node:assert');

const projetos = [];
const imovel = {
  id: 1, usuarioId: 7, endereco: 'Rua A, 1', cidade: 'São Paulo', uf: 'SP',
  eletrodomesticos: [{ potenciaW: 1000, quantidade: 2, horasDia: 7.5 }] // 450 kWh/mês, 2 kW
};
const fakePrisma = {
  imovel: { findFirst: async ({ where }) => (where.id === 1 && where.usuarioId === 7 ? imovel : null) },
  consumoHistorico: { findMany: async () => [] },
  projeto: {
    create: async ({ data }) => { const p = { id: projetos.length + 1, createdAt: new Date(), ...data }; projetos.push(p); return p; },
    findMany: async ({ where }) => projetos.filter((p) => p.imovelId === where.imovelId),
    findFirst: async ({ where }) => projetos.find((p) => p.id === where.id && p.imovelId === where.imovelId && where.imovel.usuarioId === 7) || null,
    delete: async ({ where }) => { projetos.splice(projetos.findIndex((p) => p.id === where.id), 1); }
  }
};
require.cache[require.resolve('../prisma/client')] = { id: 'x', filename: 'x', loaded: true, exports: fakePrisma };
const ctrl = require('../controllers/projetoController');
const { calcularProjeto } = require('../services/projeto');

function chamar(fn, { params = { id: '1' }, body = {}, query = {}, usuarioId = 7 } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      status(c) { this.statusCode = c; return this; },
      set(k, v) { this.headers[k] = v; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
      send(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); }
    };
    fn({ params, body, query, usuarioId }, res);
  });
}
const corpo = (extra = {}) => ({
  hsp: 4.5, hspFonte: 'Atlas Brasileiro de Energia Solar', pr: 0.75, prJustificativa: 'perdas típicas',
  painelId: 3, inversorId: 2, tarifaReaisKwh: 0.95, tarifaFonte: 'fatura', comBaterias: false, ...extra
});
const comBat = { comBaterias: true, bateriaId: 1, autonomiaHoras: 6, inversorComBateriasId: 4 };

test('PB19: calcula o fluxo completo sem baterias usando os datasets', () => {
  const r = calcularProjeto({ residencia: { endereco: 'Rua A', cidade: 'SP', uf: 'SP', potenciaInstaladaKw: 2 }, consumo: { kwhMes: 450, origem: 'estimado' }, corpo: corpo() });
  assert.strictEqual(r.erros, undefined);
  assert.strictEqual(r.alternativaSelecionada, 'sem');
  // N_mod = teto(P_FV×1000 / P_mod); P_FV = (450/30)/(4,5×0,75)
  assert.strictEqual(r.dimensionamento.modulos.quantidade, 9);
  assert.strictEqual(r.dimensionamento.potenciaInstaladaKwp, 4.95);
  assert.strictEqual(r.geracao.geracaoMensalKwh, 501.19);
  const orc = r.proposta.orcamento;
  assert.deepStrictEqual(orc.itens.map((i) => i.equipamento), ['Módulo fotovoltaico', 'Inversor']);
  assert.strictEqual(orc.total, Number((orc.itens.reduce((s, i) => s + i.subtotal, 0)).toFixed(2)));
  assert.strictEqual(r.comBaterias, null);
  assert.strictEqual(r.comparacao, null);
  assert.match(r.proposta.payback.descricao, /^Payback simples/);
});

test('PB19: com baterias calcula armazenamento, orçamento maior e comparação dos dois cenários', () => {
  const r = calcularProjeto({ residencia: { endereco: 'Rua A', cidade: 'SP', uf: 'SP', potenciaInstaladaKw: 2 }, consumo: { kwhMes: 450, origem: 'estimado' }, corpo: corpo(comBat) });
  assert.strictEqual(r.erros, undefined);
  assert.strictEqual(r.alternativaSelecionada, 'com');
  assert.strictEqual(r.armazenamento.quantidade, 2);
  assert.strictEqual(r.armazenamento.capacidadeInstaladaKwh, 4.8);
  assert.ok(r.comBaterias.orcamento.total > r.semBaterias.orcamento.total);
  assert.ok(r.comBaterias.orcamento.itens.some((i) => i.equipamento === 'Bateria'));
  assert.ok(r.comparacao.criterios.length >= 10);
  assert.ok(r.comparacao.resumo.investimentoAdicional > 0);
  assert.strictEqual(r.proposta, r.comBaterias);
  assert.ok(r.memoriaCalculo.length >= 3);
});

test('PB19: custo complementar entra no orçamento e exige descrição', () => {
  const base = { residencia: { endereco: 'Rua A', cidade: 'SP', uf: 'SP', potenciaInstaladaKw: 2 }, consumo: { kwhMes: 450, origem: 'estimado' } };
  const r = calcularProjeto({ ...base, corpo: corpo({ custoComplementarBrl: 3000, custoComplementarDescricao: 'instalação e cabeamento' }) });
  assert.ok(r.proposta.orcamento.itens.some((i) => i.equipamento === 'Custos complementares' && i.subtotal === 3000));
  assert.match(calcularProjeto({ ...base, corpo: corpo({ custoComplementarBrl: 3000 }) }).erros[0], /Descreva o custo complementar/);
});

test('PB19: o consumo informado manualmente prevalece sobre o calculado', () => {
  const base = { residencia: { endereco: 'Rua A', cidade: 'SP', uf: 'SP', potenciaInstaladaKw: 2 }, consumo: { kwhMes: 450, origem: 'estimado' } };
  const r = calcularProjeto({ ...base, corpo: corpo({ consumoKwhMes: 300, inversorId: 1 }) });
  assert.strictEqual(r.erros, undefined);
  assert.strictEqual(r.consumo.mensalKwh, 300);
  assert.strictEqual(r.consumo.origem, 'manual');
});

test('PB19: contexto da residência traz consumo, potência instalada, HSP da UF e datasets', async () => {
  const r = await chamar(ctrl.obterContexto);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.consumo.mensalKwh, 450);
  assert.strictEqual(r.body.consumo.diarioKwh, 15);
  assert.strictEqual(r.body.consumo.potenciaInstaladaKw, 2);
  assert.ok(r.body.hsp.valor > 0 && r.body.hsp.fonte);
  assert.ok(r.body.modulos.length >= 3 && r.body.baterias.length >= 2);
  assert.strictEqual((await chamar(ctrl.obterContexto, { params: { id: '99' } })).status, 404);
});

test('PB19: pré-dimensionamento e cálculo por rota, com erro 400 legível', async () => {
  const pre = await chamar(ctrl.predimensionar, { body: { hsp: 4.5, hspFonte: 'Atlas', pr: 0.75, prJustificativa: 'x', painelId: 3 } });
  assert.strictEqual(pre.status, 200);
  assert.strictEqual(pre.body.quantidadeModulos, 9);
  assert.ok(pre.body.inversores.some((i) => i.compativel));
  // corpo como a tela envia: tarifa/inversor/custos ainda em branco
  const daTela = await chamar(ctrl.predimensionar, { body: {
    consumoKwhMes: '', percentualAtendimento: '100', hsp: '4.5', hspFonte: 'Atlas', pr: '0.75', prJustificativa: 'x',
    painelId: '3', inversorId: '', comBaterias: false, tarifaReaisKwh: '', tarifaFonte: '', custoComplementarBrl: '', titulo: ''
  } });
  assert.strictEqual(daTela.status, 200);
  assert.strictEqual(daTela.body.quantidadeModulos, 9);
  const ruim = await chamar(ctrl.predimensionar, { body: { hsp: -1, hspFonte: 'Atlas', pr: 0.75, prJustificativa: 'x', painelId: 3 } });
  assert.strictEqual(ruim.status, 400);
  assert.match(ruim.body.message, /HSP/);
  const calc = await chamar(ctrl.calcular, { body: corpo() });
  assert.strictEqual(calc.status, 200);
  const falha = await chamar(ctrl.calcular, { body: corpo({ inversorId: 1 }) });
  assert.strictEqual(falha.status, 400);
  assert.match(falha.body.message, /não é compatível/);
  assert.strictEqual(projetos.length, 0, 'calcular não salva');
});

test('PB20: salva o projeto, lista, recupera e exclui — só do dono', async () => {
  const salvo = await chamar(ctrl.salvar, { body: corpo({ ...comBat, titulo: 'Casa da praia' }) });
  assert.strictEqual(salvo.status, 201);
  assert.strictEqual(salvo.body.titulo, 'Casa da praia');
  assert.strictEqual(projetos.length, 1);
  assert.strictEqual(projetos[0].alternativa, 'com');
  assert.strictEqual(projetos[0].investimentoTotalBrl, salvo.body.resultado.proposta.orcamento.total);

  const lista = await chamar(ctrl.listar);
  assert.strictEqual(lista.body.length, 1);

  const um = await chamar(ctrl.obter, { params: { id: '1', projetoId: '1' } });
  assert.strictEqual(um.status, 200);
  assert.strictEqual(um.body.entrada.painelId, 3);
  assert.ok(um.body.resultado.proposta.orcamento.total > 0);

  assert.strictEqual((await chamar(ctrl.obter, { params: { id: '1', projetoId: '1' }, usuarioId: 8 })).status, 404);
  assert.strictEqual((await chamar(ctrl.salvar, { body: corpo({ hsp: 0 }) })).status, 400);
  assert.strictEqual(projetos.length, 1, 'entrada inválida não salva');

  assert.strictEqual((await chamar(ctrl.excluir, { params: { id: '1', projetoId: '1' } })).status, 204);
  assert.strictEqual(projetos.length, 0);
});

test('PB21: exporta a proposta em HTML (e JSON) a partir do projeto salvo', async () => {
  await chamar(ctrl.salvar, { body: corpo({ titulo: '<b>Teste</b>' }) });
  const id = String(projetos[0].id);
  const html = await chamar(ctrl.proposta, { params: { id: '1', projetoId: id }, query: { formato: 'html' } });
  assert.strictEqual(html.status, 200);
  assert.match(html.headers['Content-Type'], /text\/html/);
  for (const secao of ['Residência', 'Consumo', 'Recurso solar', 'Dimensionamento', 'Orçamento', 'Economia estimada', 'Payback simples', 'Premissas']) {
    assert.ok(html.body.includes(secao), secao);
  }
  const json = await chamar(ctrl.proposta, { params: { id: '1', projetoId: id } });
  assert.ok(json.body.orcamento.total > 0);
  assert.strictEqual((await chamar(ctrl.proposta, { params: { id: '1', projetoId: '999' } })).status, 404);
});
