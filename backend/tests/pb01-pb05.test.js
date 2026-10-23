'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DIAS_MEDIO_MES, calcularPotenciaFotovoltaica } = require('../services/calculoFotovoltaico');
const { paineisDisponiveis, dimensionarSistema } = require('../services/paineis');

test('PB02: converte consumo mensal em média diária com base fixa de 30 dias', () => {
  const calculo = calcularPotenciaFotovoltaica({ consumoMensalKwh: 300, hsp: 5, pr: 0.75 });
  assert.equal(DIAS_MEDIO_MES, 30);
  assert.equal(calculo.energiaDiariaKwh, 10);
});

test('PB04: calcula P_FV = E_dia / (HSP × PR)', () => {
  const calculo = calcularPotenciaFotovoltaica({ consumoMensalKwh: 300, hsp: 5, pr: 0.75 });
  assert.ok(Math.abs(calculo.potenciaNecessariaKwp - (10 / (5 * 0.75))) < 1e-10);
  assert.equal(calculo.formulaPotencia, 'P_FV = E_dia / (HSP × PR)');
});

test('PB04: rejeita consumo não positivo, HSP inválida e PR fora de (0, 1]', () => {
  assert.ok(calcularPotenciaFotovoltaica({ consumoMensalKwh: 0, hsp: 5, pr: 0.75 }).erro);
  assert.ok(calcularPotenciaFotovoltaica({ consumoMensalKwh: 300, hsp: 0, pr: 0.75 }).erro);
  assert.ok(calcularPotenciaFotovoltaica({ consumoMensalKwh: 300, hsp: 5, pr: 0 }).erro);
  assert.ok(calcularPotenciaFotovoltaica({ consumoMensalKwh: 300, hsp: 5, pr: 1.01 }).erro);
});

test('PB05: catálogo estruturado possui os campos obrigatórios sem valores de módulo fixados na lógica', () => {
  const paineis = paineisDisponiveis();
  assert.ok(paineis.length > 0);
  for (const painel of paineis) {
    assert.ok(Number.isInteger(painel.id));
    assert.ok(painel.fabricante);
    assert.ok(painel.modelo);
    assert.ok(painel.potenciaWp > 0);
    assert.ok(painel.vmpV > 0);
    assert.ok(painel.correnteA > 0);
    assert.ok(painel.eficienciaPercentual > 0);
    assert.ok(painel.precoBrl > 0);
    assert.ok(painel.fonte);
  }
});


test('PB05: arredonda quantidade de módulos para cima e retorna potência instalada', () => {
  const resultado = dimensionarSistema({ energiaMensalKwh: 300, hsp: 5, eficiencia: 0.75, painelId: 3 });
  assert.equal(resultado.quantidade, 5);
  assert.equal(resultado.potenciaInstaladaKwp, 2.75);
  assert.equal(resultado.potenciaNecessariaKwp, 2.667);
});
