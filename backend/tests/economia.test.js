// PB15 — estimativa de economia
const test = require('node:test');
const assert = require('node:assert');
const { calcularEconomia, validarEntradas } = require('../services/economia');
const { estimar } = require('../controllers/economiaController');

// Valores de teste (não representam uma tarifa real)
const base = { tarifaReaisKwh: 0.8, tarifaFonte: 'fatura de teste', energiaGeradaKwhMes: 400, consumoKwhMes: 500 };

test('economia = E_compensada × tarifa; anual = mensal × 12', () => {
  const r = calcularEconomia(base);
  assert.strictEqual(r.energiaCompensadaKwhMes, 400);
  assert.strictEqual(r.economiaMensal, 320);
  assert.strictEqual(r.economiaAnual, 3840);
  assert.strictEqual(r.energiaExcedenteKwhMes, 0);
  assert.strictEqual(r.tarifa.fonte, 'fatura de teste');
  assert.strictEqual(r.memoriaCalculo.formula, 'Economia_mensal = E_compensada × tarifa');
  assert.ok(r.premissas.length >= 4);
});

test('geração maior que o consumo: compensa só o consumo e informa o excedente', () => {
  const r = calcularEconomia({ ...base, energiaGeradaKwhMes: 650 });
  assert.strictEqual(r.energiaCompensadaKwhMes, 500);
  assert.strictEqual(r.energiaExcedenteKwhMes, 150);
  assert.strictEqual(r.economiaMensal, 400);
  assert.ok(r.premissas.some((p) => p.includes('excedente')));
});

test('energia compensada informada tem prioridade', () => {
  const r = calcularEconomia({ ...base, energiaCompensadaKwhMes: 300 });
  assert.strictEqual(r.energiaCompensadaKwhMes, 300);
  assert.strictEqual(r.economiaMensal, 240);
  assert.ok(r.premissas.some((p) => p.includes('informada')));
});

test('geração zero: economia zero, sem erro', () => {
  const r = calcularEconomia({ ...base, energiaGeradaKwhMes: 0 });
  assert.strictEqual(r.economiaMensal, 0);
  assert.strictEqual(r.economiaAnual, 0);
});

test('validação: tarifa, fonte, consumo, geração e compensada', () => {
  assert.ok(validarEntradas({ ...base, tarifaReaisKwh: 0 })[0].includes('maior que zero'));
  assert.ok(validarEntradas({ ...base, tarifaReaisKwh: -1 }).length > 0);
  assert.ok(validarEntradas({ ...base, tarifaReaisKwh: '0.8' }).length > 0);
  assert.ok(validarEntradas({ ...base, tarifaReaisKwh: 800 })[0].includes('R$/MWh'));
  assert.ok(validarEntradas({ ...base, tarifaFonte: '  ' }).some((e) => e.includes('fonte')));
  assert.ok(validarEntradas({ ...base, consumoKwhMes: 0 }).some((e) => e.includes('consumo')));
  assert.ok(validarEntradas({ ...base, energiaGeradaKwhMes: -5 }).some((e) => e.includes('gerada')));
  assert.ok(validarEntradas({ ...base, energiaCompensadaKwhMes: 450 }).some((e) => e.includes('maior que a energia gerada')));
  assert.ok(validarEntradas({ ...base, energiaGeradaKwhMes: 900, energiaCompensadaKwhMes: 600 }).some((e) => e.includes('consumo')));
  assert.deepStrictEqual(validarEntradas(base), []);
  assert.ok(calcularEconomia(null).erros.length >= 2);
  assert.ok(calcularEconomia(undefined).erros.length >= 2);
  assert.ok(calcularEconomia({}).erros.length >= 4);
});

function chamar(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); }
    };
    estimar({ body }, res);
  });
}

test('controller: 200 e 400 com mensagem compreensível', async () => {
  const ok = await chamar(base);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.economiaMensal, 320);
  const ruim = await chamar({ ...base, tarifaReaisKwh: -2 });
  assert.strictEqual(ruim.status, 400);
  assert.ok(ruim.body.message.includes('tarifa'));
  assert.strictEqual((await chamar(undefined)).status, 400);
});
