const test = require('node:test');
const assert = require('node:assert');
const {
  validarPercentual,
  validarConsumoManual,
  validarLocalidade,
  calcularSugestaoReferencia,
  resolverConsumoReferencia
} = require('../services/dimensionamento');

// ---- PB02: percentual de atendimento ----
test('percentual: vazio assume 100 (padrão)', () => {
  assert.strictEqual(validarPercentual(undefined).valor, 100);
  assert.strictEqual(validarPercentual(null).valor, 100);
  assert.strictEqual(validarPercentual('').valor, 100);
});

test('percentual: aceita limites 1 e 100 e valores intermediários', () => {
  assert.strictEqual(validarPercentual(1).valor, 1);
  assert.strictEqual(validarPercentual(100).valor, 100);
  assert.strictEqual(validarPercentual(75.5).valor, 75.5);
  assert.strictEqual(validarPercentual('80,5').valor, 80.5);
});

test('percentual: rejeita fora do intervalo', () => {
  for (const v of [0, 0.5, 100.01, 150]) {
    assert.ok(validarPercentual(v).erro, `deveria rejeitar ${v}`);
  }
});

test('percentual: rejeita negativos e não numéricos', () => {
  assert.match(validarPercentual(-10).erro, /negativo/);
  for (const v of ['abc', '10%', NaN, Infinity, {}, [], true]) {
    assert.match(validarPercentual(v).erro, /número/, `deveria rejeitar ${String(v)}`);
  }
});

// ---- PB01: consumo manual ----
test('consumo manual: aceita positivo e arredonda a 2 casas', () => {
  assert.strictEqual(validarConsumoManual(350).valor, 350);
  assert.strictEqual(validarConsumoManual('350,456').valor, 350.46);
});

test('consumo manual: rejeita zero, negativo, texto e acima do teto', () => {
  assert.ok(validarConsumoManual(0).erro);
  assert.ok(validarConsumoManual(-5).erro);
  assert.ok(validarConsumoManual('abc').erro);
  assert.ok(validarConsumoManual(100001).erro);
});

// ---- PB01: localidade ----
test('localidade: normaliza e valida UF', () => {
  assert.deepStrictEqual(validarLocalidade({ cidade: '  São Paulo ', uf: 'sp' }), {
    cidade: 'São Paulo',
    uf: 'SP'
  });
  assert.ok(validarLocalidade({ cidade: 'X', uf: 'SP' }).erro);
  assert.ok(validarLocalidade({ cidade: 'Curitiba', uf: 'ZZ' }).erro);
  assert.ok(validarLocalidade({ cidade: undefined, uf: undefined }).erro);
});

// ---- PB01: referência ----
test('sugestão: média do histórico tem prioridade', () => {
  const s = calcularSugestaoReferencia({
    historico: [{ consumoTotalKwh: 300 }, { consumoTotalKwh: 400 }],
    consumoEstimadoKwh: 999
  });
  assert.deepStrictEqual(s, { consumoKwhMes: 350, origem: 'historico', mesesHistorico: 2 });
});

test('sugestão: sem histórico usa estimativa dos eletrodomésticos', () => {
  const s = calcularSugestaoReferencia({ historico: [], consumoEstimadoKwh: 123.456 });
  assert.strictEqual(s.origem, 'estimado');
  assert.strictEqual(s.consumoKwhMes, 123.46);
});

test('sugestão: sem histórico nem eletrodomésticos retorna null', () => {
  assert.strictEqual(calcularSugestaoReferencia({ historico: [], consumoEstimadoKwh: 0 }), null);
});

test('resolver: bloqueia sem referência e sem valor manual', () => {
  const r = resolverConsumoReferencia({ consumoManual: undefined, sugestao: null });
  assert.strictEqual(r.codigo, 'SEM_CONSUMO_REFERENCIA');
});

test('resolver: valor manual destrava o fluxo e tem prioridade sobre a sugestão', () => {
  const sugestao = { consumoKwhMes: 350, origem: 'historico', mesesHistorico: 3 };
  assert.deepStrictEqual(resolverConsumoReferencia({ consumoManual: 500, sugestao }), {
    consumoKwhMes: 500,
    origem: 'manual'
  });
  assert.strictEqual(resolverConsumoReferencia({ consumoManual: 500, sugestao: null }).origem, 'manual');
});

test('resolver: sem valor manual usa a sugestão', () => {
  const sugestao = { consumoKwhMes: 350, origem: 'historico', mesesHistorico: 3 };
  assert.deepStrictEqual(resolverConsumoReferencia({ consumoManual: '', sugestao }), {
    consumoKwhMes: 350,
    origem: 'historico'
  });
});

test('resolver: valor manual inválido retorna erro (não cai na sugestão)', () => {
  const sugestao = { consumoKwhMes: 350, origem: 'historico', mesesHistorico: 3 };
  assert.ok(resolverConsumoReferencia({ consumoManual: -1, sugestao }).erro);
});

// ---- PB04: E_FV = C_m × f ----
const { calcularEnergiaFv, montarLogEnergiaFv } = require('../services/dimensionamento');

test('E_FV: 350 kWh a 100% = 350; a 80% = 280', () => {
  assert.strictEqual(calcularEnergiaFv(350, 100).valor, 350);
  assert.strictEqual(calcularEnergiaFv(350, 80).valor, 280);
});

test('E_FV: arredonda a 2 casas', () => {
  assert.strictEqual(calcularEnergiaFv(333.33, 33).valor, 110);
  assert.strictEqual(calcularEnergiaFv(100.5, 33.3).valor, 33.47);
});

test('E_FV: valida C_m e f antes de calcular', () => {
  for (const [c, f] of [[0, 100], [-1, 100], [NaN, 100], [100, 0], [100, 101], [100, NaN], [undefined, 50]]) {
    assert.ok(calcularEnergiaFv(c, f).erro, `deveria rejeitar C_m=${c}, f=${f}`);
  }
});

test('E_FV: recalcula ao alterar qualquer parâmetro', () => {
  assert.strictEqual(calcularEnergiaFv(300, 50).valor, 150);
  assert.strictEqual(calcularEnergiaFv(400, 50).valor, 200); // consumo mudou
  assert.strictEqual(calcularEnergiaFv(400, 25).valor, 100); // percentual mudou
});

test('E_FV: log registra fórmula, entradas, resultado e unidade', () => {
  const log = montarLogEnergiaFv(350, 80, 280);
  assert.strictEqual(log.etapa, 'E_FV');
  assert.strictEqual(log.formula, 'E_FV = C_m × f');
  assert.deepStrictEqual(log.entradas, { C_m_kWh_mes: 350, f_percentual: 80, f_fracao: 0.8 });
  assert.strictEqual(log.resultado, 280);
  assert.strictEqual(log.unidade, 'kWh/mês');
});
