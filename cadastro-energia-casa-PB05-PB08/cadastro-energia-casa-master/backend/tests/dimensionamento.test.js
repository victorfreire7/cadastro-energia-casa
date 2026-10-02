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

// ---- PB05: potência FV necessária ----
const {
  calcularPotenciaFv,
  montarLogPotenciaFv,
  validarEta,
  validarDias,
  ETA_PADRAO,
  ETA_FONTE,
  DIAS_PADRAO
} = require('../services/dimensionamento');

test('P_FV: fórmula E_FV / (HSP × D × η)', () => {
  // 300 / (5 × 30 × 0,8) = 2,5 kWp
  assert.strictEqual(calcularPotenciaFv({ energiaKwhMes: 300, hsp: 5, dias: 30, eta: 0.8 }).valor, 2.5);
  // 450 / (5,1 × 30 × 0,8) = 3,676 kWp (3 casas)
  assert.strictEqual(calcularPotenciaFv({ energiaKwhMes: 450, hsp: 5.1, dias: 30, eta: 0.8 }).valor, 3.676);
});

test('P_FV: usa D=30 e η=0,80 por padrão', () => {
  assert.strictEqual(DIAS_PADRAO, 30);
  assert.strictEqual(ETA_PADRAO, 0.8);
  assert.ok(ETA_FONTE.length > 0); // fonte documentada
  assert.strictEqual(
    calcularPotenciaFv({ energiaKwhMes: 300, hsp: 5 }).valor,
    calcularPotenciaFv({ energiaKwhMes: 300, hsp: 5, dias: 30, eta: 0.8 }).valor
  );
});

test('P_FV: trata divisão por zero e HSP inválido', () => {
  const ok = { energiaKwhMes: 300, hsp: 5, dias: 30, eta: 0.8 };
  for (const hsp of [0, -1, NaN, Infinity, undefined, null]) {
    assert.match(calcularPotenciaFv({ ...ok, hsp }).erro, /HSP/, `hsp=${hsp}`);
  }
  assert.ok(calcularPotenciaFv({ ...ok, dias: 0 }).erro);
  assert.ok(calcularPotenciaFv({ ...ok, eta: 0 }).erro);
  assert.ok(calcularPotenciaFv({ ...ok, energiaKwhMes: 0 }).erro);
});

test('P_FV: η menor ou HSP menor exigem mais potência', () => {
  const base = calcularPotenciaFv({ energiaKwhMes: 300, hsp: 5, dias: 30, eta: 0.8 }).valor;
  assert.ok(calcularPotenciaFv({ energiaKwhMes: 300, hsp: 5, dias: 30, eta: 0.7 }).valor > base);
  assert.ok(calcularPotenciaFv({ energiaKwhMes: 300, hsp: 4, dias: 30, eta: 0.8 }).valor > base);
});

test('η: vazio assume padrão; aceita 0,5–0,95; rejeita fora da faixa e não numéricos', () => {
  assert.strictEqual(validarEta(undefined).valor, 0.8);
  assert.strictEqual(validarEta('').valor, 0.8);
  assert.strictEqual(validarEta('0,85').valor, 0.85);
  assert.strictEqual(validarEta(0.5).valor, 0.5);
  for (const v of [0, 0.49, 0.96, 1, 80, -0.8]) assert.ok(validarEta(v).erro, `deveria rejeitar ${v}`);
  for (const v of ['abc', NaN, {}, true]) assert.match(validarEta(v).erro, /número/);
});

test('D: vazio assume 30; aceita inteiros 28–31; rejeita o resto', () => {
  assert.strictEqual(validarDias(undefined).valor, 30);
  assert.strictEqual(validarDias(28).valor, 28);
  assert.strictEqual(validarDias('31').valor, 31);
  for (const v of [0, 27, 32, -30, 30.5, 'abc']) assert.ok(validarDias(v).erro, `deveria rejeitar ${v}`);
});

test('P_FV: log de evidência com fórmula, entradas e resultado', () => {
  const log = montarLogPotenciaFv({ energiaKwhMes: 300, hsp: 5, dias: 30, eta: 0.8, potenciaKwp: 2.5 });
  assert.deepStrictEqual(log, {
    etapa: 'P_FV',
    formula: 'P_FV = E_FV / (HSP × D × η)',
    entradas: { E_FV_kWh_mes: 300, HSP_h_dia: 5, D_dias: 30, eta: 0.8 },
    resultado: 2.5,
    unidade: 'kWp'
  });
});
