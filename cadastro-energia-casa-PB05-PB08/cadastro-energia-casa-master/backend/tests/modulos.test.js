const test = require('node:test');
const assert = require('node:assert');
const {
  LIMITE_ALERTA_PCT,
  calcularQuantidadeModulos,
  calcularPotenciaInstalada,
  compararPotencias,
  avaliarModulo,
  selecionarModuloPadrao,
  listarOpcoes,
  resolverModulo,
  montarLogQuantidadeModulos,
  montarLogPotenciaInstalada
} = require('../services/modulos');
const { listarPaineis, obterPainelPorId } = require('../services/paineis');

const paineis = listarPaineis();

// ---- PB07: N = ceil((P_FV × 1000) / P_módulo) ----
test('N: arredonda sempre para cima', () => {
  assert.strictEqual(calcularQuantidadeModulos(2.128, 550).valor, 4); // 3,87 → 4
  assert.strictEqual(calcularQuantidadeModulos(2.2, 550).valor, 4); // exato
  assert.strictEqual(calcularQuantidadeModulos(2.201, 550).valor, 5); // 4,002 → 5
  assert.strictEqual(calcularQuantidadeModulos(0.1, 550).valor, 1); // mínimo de 1 módulo
});

test('N: ruído de ponto flutuante não soma um módulo a mais', () => {
  // 0,55 × 1000 = 550,00000000000006 em ponto flutuante
  assert.strictEqual(calcularQuantidadeModulos(0.55, 550).valor, 1);
  assert.strictEqual(calcularQuantidadeModulos(1.65, 550).valor, 3);
  assert.strictEqual(calcularQuantidadeModulos(4.4, 550).valor, 8);
});

test('N: rejeita P_FV ou potência do módulo inválidos', () => {
  for (const v of [0, -1, NaN, Infinity, undefined]) {
    assert.ok(calcularQuantidadeModulos(v, 550).erro, `P_FV=${v}`);
    assert.ok(calcularQuantidadeModulos(2, v).erro, `P_mod=${v}`);
  }
});

// ---- PB08: P_instalada = (N × P_módulo) / 1000 ----
test('P_instalada: fórmula em kWp', () => {
  assert.strictEqual(calcularPotenciaInstalada(4, 550).valor, 2.2);
  assert.strictEqual(calcularPotenciaInstalada(7, 575).valor, 4.025);
});

test('P_instalada: rejeita N não inteiro/≤0 e potência inválida', () => {
  for (const n of [0, -1, 2.5, NaN, undefined]) assert.ok(calcularPotenciaInstalada(n, 550).erro, `N=${n}`);
  assert.ok(calcularPotenciaInstalada(4, 0).erro);
});

test('comparação: ok dentro de ±10%, folga acima, déficit abaixo', () => {
  assert.strictEqual(LIMITE_ALERTA_PCT, 10);
  const ok = compararPotencias(2.2, 2.128);
  assert.strictEqual(ok.status, 'ok');
  assert.strictEqual(ok.mensagem, null);
  assert.strictEqual(ok.diferencaKwp, 0.072);
  assert.strictEqual(ok.desvioPct, 3.4);

  const folga = compararPotencias(0.55, 0.3); // +83,3%
  assert.strictEqual(folga.status, 'folga');
  assert.match(folga.mensagem, /acima/);

  const deficit = compararPotencias(2.0, 2.5); // −20%
  assert.strictEqual(deficit.status, 'deficit');
  assert.match(deficit.mensagem, /abaixo/);
  assert.strictEqual(deficit.diferencaKwp, -0.5);

  // fronteira: exatamente 10% ainda é ok
  assert.strictEqual(compararPotencias(2.2, 2.0).status, 'ok');
  assert.strictEqual(compararPotencias(2.21, 2.0).status, 'folga');
});

test('com N calculado por ceil, P_instalada nunca fica abaixo de P_FV', () => {
  for (const p of paineis) {
    for (const pfv of [0.3, 1.234, 2.128, 3.676, 7.5, 12.345]) {
      const a = avaliarModulo(p, pfv);
      assert.ok(a.potenciaInstaladaKwp >= pfv, `${p.modelo} P_FV=${pfv}`);
      assert.notStrictEqual(a.comparacao.status, 'deficit');
    }
  }
});

// ---- PB07: seleção ----
test('seleção automática: menor custo total dos módulos', () => {
  const padrao = selecionarModuloPadrao(paineis, 2.128);
  const todos = paineis.map((p) => avaliarModulo(p, 2.128).custoModulosBrl);
  assert.strictEqual(padrao.custoModulosBrl, Math.min(...todos));
});

test('seleção automática: empate de custo desempata por eficiência e depois por id', () => {
  const a = { id: 1, fabricante: 'A', modelo: 'a', potenciaWp: 500, eficienciaPct: 20, precoBrl: 500 };
  const b = { ...a, id: 2, eficienciaPct: 22 };
  const c = { ...b, id: 3 };
  assert.strictEqual(selecionarModuloPadrao([a, b, c], 2).painel.id, 2);
  assert.strictEqual(selecionarModuloPadrao([], 2), null);
});

test('opções: lista todo o dataset já calculado e marca o padrão', () => {
  const { padraoId, opcoes } = listarOpcoes(paineis, 2.128);
  assert.strictEqual(opcoes.length, paineis.length);
  assert.ok(opcoes.some((o) => o.moduloId === padraoId));
  for (const o of opcoes) {
    assert.strictEqual(o.quantidade, Math.ceil(Number(((2.128 * 1000) / o.potenciaWp).toFixed(6))));
    assert.strictEqual(o.potenciaInstaladaKwp, Number(((o.quantidade * o.potenciaWp) / 1000).toFixed(3)));
  }
});

test('resolverModulo: manual válido, automático e validação da existência', () => {
  const base = { paineis, obterPainel: obterPainelPorId, potenciaFvKwp: 2.128 };

  const manual = resolverModulo({ ...base, moduloId: 4 });
  assert.strictEqual(manual.origem, 'manual');
  assert.strictEqual(manual.avaliacao.painel.id, 4);
  assert.strictEqual(manual.avaliacao.quantidade, 4);

  assert.strictEqual(resolverModulo({ ...base, moduloId: '2' }).avaliacao.painel.id, 2);

  for (const v of [undefined, null, '']) {
    assert.strictEqual(resolverModulo({ ...base, moduloId: v }).origem, 'automatica');
  }

  assert.match(resolverModulo({ ...base, moduloId: 999 }).erro, /não existe/);
  for (const v of ['abc', 0, -1, 1.5]) {
    assert.match(resolverModulo({ ...base, moduloId: v }).erro, /inteiro positivo/, String(v));
  }
});

test('logs: fórmulas, entradas e resultados', () => {
  const painel = obterPainelPorId(1);
  const a = avaliarModulo(painel, 2.128);
  const logN = montarLogQuantidadeModulos({ potenciaFvKwp: 2.128, painel, quantidade: a.quantidade });
  assert.strictEqual(logN.etapa, 'N_MODULOS');
  assert.strictEqual(logN.resultado, 4);
  assert.strictEqual(logN.unidade, 'módulos');
  const logP = montarLogPotenciaInstalada({
    quantidade: 4, painel, potenciaInstaladaKwp: a.potenciaInstaladaKwp, comparacao: a.comparacao
  });
  assert.strictEqual(logP.etapa, 'P_INSTALADA');
  assert.strictEqual(logP.resultado, 2.2);
  assert.strictEqual(logP.entradas.status, 'ok');
});
