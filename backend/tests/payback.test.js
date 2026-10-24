// PB16 — payback simples
const test = require('node:test');
const assert = require('node:assert');
const { calcularPayback, validarEntradas, PRAZO_ALERTA_ANOS } = require('../services/payback');
const { calcular } = require('../controllers/paybackController');

// Valores de teste (não representam um sistema real)
test('payback = investimento / economia anual, rotulado como payback simples', () => {
  const r = calcularPayback({ investimentoTotal: 20000, economiaAnual: 4000 });
  assert.strictEqual(r.tipo, 'payback simples');
  assert.strictEqual(r.paybackAnos, 5);
  assert.strictEqual(r.paybackMeses, 60);
  assert.ok(r.descricao.startsWith('Payback simples'));
  assert.strictEqual(r.memoriaCalculo.formula, 'Payback = Investimento / Economia_anual');
  assert.deepStrictEqual(r.avisos, []);
});

test('não é apresentado como previsão financeira exata', () => {
  const r = calcularPayback({ investimentoTotal: 20000, economiaAnual: 4000 });
  assert.ok(r.premissas.some((p) => p.includes('não é previsão financeira exata')));
  assert.ok(r.premissas.some((p) => p.includes('juros')));
});

test('resultado fracionário: anos com 2 casas e meses arredondados para cima', () => {
  const r = calcularPayback({ investimentoTotal: 25000, economiaAnual: 4800 });
  assert.strictEqual(r.paybackAnos, 5.21);
  assert.strictEqual(r.paybackMeses, 63);
  assert.ok(r.descricao.includes('5 anos e 3 meses'));
});

test('economia anual zero: payback indefinido, sem divisão por zero', () => {
  const r = calcularPayback({ investimentoTotal: 20000, economiaAnual: 0 });
  assert.strictEqual(r.erros, undefined);
  assert.strictEqual(r.paybackAnos, null);
  assert.strictEqual(r.paybackMeses, null);
  assert.ok(r.descricao.includes('indefinido'));
  assert.ok(r.avisos.length > 0);
});

test('payback muito longo gera aviso', () => {
  const r = calcularPayback({ investimentoTotal: 100000, economiaAnual: 3000 });
  assert.ok(r.paybackAnos > PRAZO_ALERTA_ANOS);
  assert.ok(r.avisos.some((a) => a.includes('vida útil')));
});

test('validação: investimento e economia inválidos', () => {
  assert.ok(validarEntradas({ investimentoTotal: 0, economiaAnual: 100 })[0].includes('investimento'));
  assert.ok(validarEntradas({ investimentoTotal: -5, economiaAnual: 100 }).length > 0);
  assert.ok(validarEntradas({ investimentoTotal: '20000', economiaAnual: 100 }).length > 0);
  assert.ok(validarEntradas({ investimentoTotal: 1000, economiaAnual: -1 })[0].includes('economia'));
  assert.ok(validarEntradas({ investimentoTotal: 1000, economiaAnual: NaN }).length > 0);
  assert.ok(calcularPayback(null).erros.length >= 2);
  assert.ok(calcularPayback(undefined).erros.length >= 2);
  assert.ok(calcularPayback({}).erros.length >= 2);
  assert.deepStrictEqual(validarEntradas({ investimentoTotal: 1000, economiaAnual: 0 }), []);
});

function chamar(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); }
    };
    calcular({ body }, res);
  });
}

test('controller: 200 e 400 com mensagem compreensível', async () => {
  const ok = await chamar({ investimentoTotal: 20000, economiaAnual: 4000 });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.paybackAnos, 5);
  const ruim = await chamar({ investimentoTotal: -1, economiaAnual: 4000 });
  assert.strictEqual(ruim.status, 400);
  assert.ok(ruim.body.message.includes('payback simples'));
  assert.strictEqual((await chamar(undefined)).status, 400);
});
