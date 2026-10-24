// PB17 — proposta consolidada
const test = require('node:test');
const assert = require('node:assert');
const { montarProposta, montarOrcamento, renderizarHtml } = require('../services/proposta');
const { gerar } = require('../controllers/propostaController');

// Valores de teste (não representam equipamentos nem preços reais)
function entrada() {
  return {
    residencia: { endereco: 'Rua Teste, 10', cidade: 'Curitiba', uf: 'PR' },
    consumo: { mensalKwh: 500, potenciaInstaladaKw: 6.2 },
    recursoSolar: { hsp: 4.5, hspFonte: 'tabela de teste', pr: 0.8, prJustificativa: 'perdas típicas de sistema residencial' },
    potenciaFvNecessariaKwp: 4.6,
    potenciaInstaladaKwp: 4.8,
    modulos: { fabricante: 'FabA', modelo: 'M-600', quantidade: 8, potenciaWp: 600 },
    inversor: { fabricante: 'FabI', modelo: 'I-5K', potenciaKw: 5 },
    geracaoMensalKwh: 400,
    atendimentoPercent: 80,
    bateria: null,
    orcamento: {
      itens: [
        { equipamento: 'Módulo FV', fabricanteModelo: 'FabA M-600', quantidade: 8, precoUnitario: 600 },
        { equipamento: 'Inversor', fabricanteModelo: 'FabI I-5K', quantidade: 1, precoUnitario: 3500 }
      ]
    },
    tarifa: { valorReaisKwh: 0.8, fonte: 'fatura de teste' }
  };
}

test('proposta sem baterias reúne todas as seções exigidas', () => {
  const p = montarProposta(entrada());
  assert.strictEqual(p.erros, undefined);
  assert.strictEqual(p.residencia.cidade, 'Curitiba');
  assert.strictEqual(p.consumo.diarioKwh, 16.67);
  assert.strictEqual(p.recursoSolar.hsp, 4.5);
  assert.strictEqual(p.dimensionamento.potenciaInstaladaKwp, 4.8);
  assert.strictEqual(p.geracao.diariaKwh, 13.33);
  assert.strictEqual(p.geracao.atendimentoPercent, 80);
  assert.strictEqual(p.armazenamento.tipo, 'sem baterias');
  assert.strictEqual(p.orcamento.total, 8300);
  assert.strictEqual(p.economia.economiaMensal, 320);
  assert.strictEqual(p.economia.economiaAnual, 3840);
  assert.strictEqual(p.payback.paybackAnos, 2.16);
  assert.strictEqual(p.payback.tipo, 'payback simples');
});

test('proposta com baterias inclui capacidade e autonomia', () => {
  const e = entrada();
  e.bateria = { fabricante: 'FabB', modelo: 'B-5', quantidade: 2, capacidadeTotalKwh: 10 };
  e.autonomiaHoras = 8;
  e.orcamento.itens.push({ equipamento: 'Bateria', fabricanteModelo: 'FabB B-5', quantidade: 2, precoUnitario: 6000 });
  const p = montarProposta(e);
  assert.strictEqual(p.armazenamento.tipo, 'com baterias');
  assert.strictEqual(p.armazenamento.autonomiaHoras, 8);
  assert.strictEqual(p.orcamento.total, 20300);
});

test('orçamento: Custo_item = quantidade × preço e total = soma (não usa total enviado)', () => {
  const o = montarOrcamento([
    { equipamento: 'A', fabricanteModelo: 'x', quantidade: 3, precoUnitario: 10.5 },
    { equipamento: 'B', fabricanteModelo: 'y', quantidade: 2, precoUnitario: 100 }
  ]);
  assert.deepStrictEqual(o.itens.map((i) => i.subtotal), [31.5, 200]);
  assert.strictEqual(o.total, 231.5);
  const e = entrada();
  e.orcamento.total = 1;
  assert.strictEqual(montarProposta(e).orcamento.total, 8300);
});

test('validação: dados ausentes ou inválidos geram mensagens', () => {
  assert.ok(montarProposta(undefined).erros.length > 0);
  const e = entrada();
  e.recursoSolar.hsp = 0;
  e.recursoSolar.pr = 1.5;
  e.recursoSolar.prJustificativa = '';
  e.consumo.mensalKwh = -10;
  e.orcamento.itens = [];
  const erros = montarProposta(e).erros;
  for (const trecho of ['HSP', 'PR deve', 'justifique', 'consumo mensal', 'orçamento']) {
    assert.ok(erros.some((m) => m.includes(trecho)), trecho);
  }
  const semAutonomia = entrada();
  semAutonomia.bateria = { fabricante: 'F', modelo: 'M', quantidade: 1, capacidadeTotalKwh: 5 };
  assert.ok(montarProposta(semAutonomia).erros.some((m) => m.includes('autonomia')));
  const semTarifa = entrada();
  semTarifa.tarifa = undefined;
  assert.ok(montarProposta(semTarifa).erros.some((m) => m.includes('tarifa')));
});

test('aviso quando a potência instalada é menor que a necessária', () => {
  const e = entrada();
  e.potenciaInstaladaKwp = 4.0;
  assert.ok(montarProposta(e).avisos.some((a) => a.includes('menor')));
});

test('relatório HTML tem as seções e escapa texto do usuário', () => {
  const e = entrada();
  e.residencia.endereco = '<script>alert(1)</script>';
  const html = renderizarHtml(montarProposta(e));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  for (const secao of ['Residência', 'Consumo', 'Recurso solar', 'Dimensionamento', 'Geração e atendimento', 'Armazenamento', 'Orçamento', 'Economia estimada', 'Payback simples', 'Premissas']) {
    assert.ok(html.includes(secao), secao);
  }
  assert.ok(html.includes('R$ 8.300,00'));
  assert.ok(html.includes('Sem baterias'));
  assert.ok(html.includes('R$ 0,8000/kWh') && !html.includes('anos 2.16'));
});

function chamar(body, query = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      status(c) { this.statusCode = c; return this; },
      set(k, v) { this.headers[k] = v; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
      send(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); }
    };
    gerar({ body, query }, res);
  });
}

test('controller: JSON, HTML e 400', async () => {
  const json = await chamar(entrada());
  assert.strictEqual(json.status, 200);
  assert.strictEqual(json.body.orcamento.total, 8300);
  const html = await chamar(entrada(), { formato: 'html' });
  assert.ok(html.headers['Content-Type'].startsWith('text/html'));
  assert.ok(html.body.startsWith('<!doctype html>'));
  const ruim = await chamar({});
  assert.strictEqual(ruim.status, 400);
  assert.ok(ruim.body.message.includes('proposta'));
});
