'use strict';

const DIAS_MEDIO_MES = 30;

function calcularGeracaoFotovoltaica({ potenciaInstaladaKwp, hsp, pr, consumoMensalKwh }) {
  const entradas = { potenciaInstaladaKwp, hsp, pr, consumoMensalKwh };
  for (const [campo, valor] of Object.entries(entradas)) {
    if (!Number.isFinite(Number(valor)) || Number(valor) <= 0) {
      return { erro: `${campo} deve ser um número maior que zero` };
    }
  }
  if (Number(pr) > 1) return { erro: 'PR deve ser maior que zero e menor ou igual a 1 (100%)' };

  const geracaoDiariaKwh = Number(potenciaInstaladaKwp) * Number(hsp) * Number(pr);
  const geracaoMensalKwh = geracaoDiariaKwh * DIAS_MEDIO_MES;
  const atendimentoPercentual = (geracaoMensalKwh / Number(consumoMensalKwh)) * 100;
  const energiaCompensadaKwh = Math.min(geracaoMensalKwh, Number(consumoMensalKwh));
  const excedenteKwh = Math.max(0, geracaoMensalKwh - Number(consumoMensalKwh));

  return {
    geracaoDiariaKwh: Number(geracaoDiariaKwh.toFixed(2)),
    geracaoMensalKwh: Number(geracaoMensalKwh.toFixed(2)),
    consumoMensalKwh: Number(Number(consumoMensalKwh).toFixed(2)),
    atendimentoPercentual: Number(atendimentoPercentual.toFixed(2)),
    atendimentoEfetivoPercentual: Number(Math.min(100, atendimentoPercentual).toFixed(2)),
    energiaCompensadaKwh: Number(energiaCompensadaKwh.toFixed(2)),
    excedenteKwh: Number(excedenteKwh.toFixed(2)),
    diasMedioMes: DIAS_MEDIO_MES,
    formulaDiaria: 'E_gerada,dia = P_inst × HSP × PR',
    formulaMensal: 'E_gerada,mês = E_gerada,dia × 30',
    formulaAtendimento: 'Atendimento (%) = (E_gerada,mês / E_consumida,mês) × 100'
  };
}

module.exports = { DIAS_MEDIO_MES, calcularGeracaoFotovoltaica };
