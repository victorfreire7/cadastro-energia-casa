'use strict';

const DIAS_MEDIO_MES = 30;

/**
 * PB02/PB04 — calcula a energia diária e a potência FV necessária.
 *
 * O PR é a fração global de desempenho do sistema (0 < PR <= 1), incluindo
 * perdas de conversão, temperatura, cabeamento, sujeira e descasamento.
 * Retorna { erro } em entradas inválidas para que a API converta o resultado
 * em uma mensagem compreensível, sem propagar NaN/Infinity.
 */
function calcularPotenciaFotovoltaica({ consumoMensalKwh, hsp, pr }) {
  const consumo = Number(consumoMensalKwh);
  const horasSolPico = Number(hsp);
  const performanceRatio = Number(pr);

  if (!Number.isFinite(consumo) || consumo <= 0) {
    return { erro: 'o consumo mensal usado no dimensionamento deve ser maior que zero' };
  }
  if (!Number.isFinite(horasSolPico) || horasSolPico <= 0) {
    return { erro: 'HSP deve ser um número maior que zero' };
  }
  if (!Number.isFinite(performanceRatio) || performanceRatio <= 0 || performanceRatio > 1) {
    return { erro: 'PR deve ser maior que zero e menor ou igual a 1 (100%)' };
  }

  const energiaDiariaKwh = consumo / DIAS_MEDIO_MES;
  const potenciaNecessariaKwp = energiaDiariaKwh / (horasSolPico * performanceRatio);

  if (!Number.isFinite(potenciaNecessariaKwp) || potenciaNecessariaKwp <= 0) {
    return { erro: 'não foi possível calcular uma potência fotovoltaica válida com os parâmetros informados' };
  }

  return {
    consumoMensalKwh: consumo,
    energiaDiariaKwh,
    hsp: horasSolPico,
    pr: performanceRatio,
    potenciaNecessariaKwp,
    diasMedioMes: DIAS_MEDIO_MES,
    formulaEnergiaDiaria: 'E_dia = E_mes / 30',
    formulaPotencia: 'P_FV = E_dia / (HSP × PR)'
  };
}

module.exports = { DIAS_MEDIO_MES, calcularPotenciaFotovoltaica };
