// PB14 — comparação dos cenários sem e com baterias
const test = require('node:test');
const assert = require('node:assert');
const { compararCenarios, validarCenario, CRITERIOS } = require('../services/comparacao');
const { comparar } = require('../controllers/comparacaoController');

// Valores de teste (não são dados reais de equipamentos nem de mercado)
function semBat() {
  return {
    potenciaFvNecessariaKwp: 4.2,
    modulos: { fabricante: 'FabA', modelo: 'M-550', quantidade: 8, potenciaWp: 550 },
    potenciaInstaladaKwp: 4.4,
    inversor: { fabricante: 'FabI', modelo: 'I-5K', potenciaKw: 5 },
    geracaoMensalKwh: 520,
    atendimentoPercent: 100,
    bateria: null,
    autonomiaHoras: null,
    investimentoTotal: 20000
  };
}
function comBat() {
  return {
    ...semBat(),
    bateria: { fabricante: 'FabB', modelo: 'B-5', quantidade: 2, capacidadeTotalKwh: 10 },
    autonomiaHoras: 8,
    atendimentoPercent: 100,
    investimentoTotal: 32000
  };
}
const linha = (r, chave) => r.criterios.find((c) => c.chave === chave);

test('compara todos os critérios exigidos pela PB14', () => {
  const r = compararCenarios({ semBaterias: semBat(), comBaterias: comBat() });
  assert.strictEqual(r.erros, undefined);
  assert.deepStrictEqual(r.criterios.map((c) => c.chave), CRITERIOS.map((c) => c.chave));
  assert.strictEqual(linha(r, 'modulos').sem, '8 × FabA M-550 (550 Wp)');
  assert.strictEqual(linha(r, 'modulos').igual, true);
  assert.strictEqual(linha(r, 'armazenamento').sem, 'Sem baterias');
  assert.strictEqual(linha(r, 'armazenamento').com, '2 × FabB B-5');
  assert.strictEqual(linha(r, 'armazenamento').igual, false);
});

test('diferenças numéricas e divisão por zero', () => {
  const r = compararCenarios({ semBaterias: semBat(), comBaterias: comBat() });
  const inv = linha(r, 'investimentoTotal');
  assert.strictEqual(inv.diferenca, 12000);
  assert.strictEqual(inv.diferencaPercent, 60);
  // sem baterias a base é 0: variação percentual indefinida (null), diferença absoluta mantida
  const cap = linha(r, 'capacidadeArmazenadaKwh');
  assert.strictEqual(cap.sem, 0);
  assert.strictEqual(cap.com, 10);
  assert.strictEqual(cap.diferencaPercent, null);
  assert.strictEqual(linha(r, 'autonomiaHoras').sem, 0);
});

test('resumo: investimento adicional e custo por ponto percentual', () => {
  const sem = semBat();
  sem.atendimentoPercent = 60;
  const r = compararCenarios({ semBaterias: sem, comBaterias: comBat() });
  assert.strictEqual(r.resumo.investimentoAdicional, 12000);
  assert.strictEqual(r.resumo.ganhoAtendimentoPontosPercentuais, 40);
  assert.strictEqual(r.resumo.investimentoPorPontoPercentual, 300);
  assert.deepStrictEqual(r.avisos, []);
});

test('sem ganho de atendimento: não divide por zero e avisa', () => {
  const r = compararCenarios({ semBaterias: semBat(), comBaterias: comBat() });
  assert.strictEqual(r.resumo.investimentoPorPontoPercentual, null);
  assert.ok(r.avisos.some((a) => a.includes('não aumentaram')));
});

test('aviso quando o cenário com baterias custa menos', () => {
  const com = comBat();
  com.investimentoTotal = 15000;
  const r = compararCenarios({ semBaterias: semBat(), comBaterias: com });
  assert.ok(r.avisos.some((a) => a.includes('menor')));
});

test('validação: dados ausentes, negativos e incompatíveis (PB18)', () => {
  assert.ok(compararCenarios({}).erros.length >= 2);
  assert.ok(compararCenarios(null).erros.length >= 2);
  assert.ok(compararCenarios(undefined).erros.length >= 2);

  const neg = semBat();
  neg.investimentoTotal = -1;
  assert.ok(compararCenarios({ semBaterias: neg, comBaterias: comBat() }).erros[0].includes('investimento'));

  const semMod = semBat();
  semMod.modulos.quantidade = 0;
  assert.ok(validarCenario(semMod, 'sem baterias', false).some((e) => e.includes('módulos')));

  const comBateriaNoSem = { ...semBat(), bateria: comBat().bateria };
  assert.ok(validarCenario(comBateriaNoSem, 'sem baterias', false).some((e) => e.includes('não pode conter')));

  const comSemBateria = comBat();
  comSemBateria.bateria = null;
  assert.ok(validarCenario(comSemBateria, 'com baterias', true).some((e) => e.includes('baterias exigem')));

  const semAutonomia = comBat();
  semAutonomia.autonomiaHoras = 0;
  assert.ok(validarCenario(semAutonomia, 'com baterias', true).some((e) => e.includes('autonomia')));

  const naoNumero = semBat();
  naoNumero.geracaoMensalKwh = '520';
  assert.ok(compararCenarios({ semBaterias: naoNumero, comBaterias: comBat() }).erros.length > 0);
});

function chamar(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); }
    };
    comparar({ body }, res);
  });
}

test('controller: 200 com comparação e 400 com mensagem compreensível', async () => {
  const ok = await chamar({ semBaterias: semBat(), comBaterias: comBat() });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.criterios.length, CRITERIOS.length);

  const ruim = await chamar({ semBaterias: semBat() });
  assert.strictEqual(ruim.status, 400);
  assert.ok(ruim.body.message.includes('com baterias'));

  const vazio = await chamar(undefined);
  assert.strictEqual(vazio.status, 400);
});
