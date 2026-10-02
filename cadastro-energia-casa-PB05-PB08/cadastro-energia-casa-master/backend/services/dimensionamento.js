const { UFS } = require('../utils/ufs');

// PB01 — histórico mínimo para considerar a média como referência (em meses)
const HISTORICO_MINIMO_MESES = 1;
// Janela usada na média do histórico (últimos N registros)
const JANELA_HISTORICO_MESES = 12;
// Teto de sanidade para consumo informado manualmente (kWh/mês)
const CONSUMO_MAX_KWH_MES = 100000;

// PB02 — percentual de consumo a atender
const PERCENTUAL_PADRAO = 100;
const PERCENTUAL_MIN = 1;
const PERCENTUAL_MAX = 100;

// PB05 — parâmetros do cálculo de potência FV: P_FV = E_FV / (HSP × D × η)
// η (taxa de desempenho / performance ratio): perdas por temperatura, sujeira, cabeamento,
// inversor e descasamento. Valor típico de projeto residencial no Brasil: 0,70–0,85;
// adotamos 0,80. Referência: CRESESB/CEPEL, "Manual de Engenharia para Sistemas
// Fotovoltaicos" (2014) — validar com o orientador/professor antes de usar em proposta real.
const ETA_PADRAO = 0.8;
const ETA_MIN = 0.5;
const ETA_MAX = 0.95;
const ETA_FONTE =
  'Taxa de desempenho típica de sistemas FV residenciais (0,70–0,85); padrão 0,80 — ref.: CRESESB/CEPEL, Manual de Engenharia para Sistemas Fotovoltaicos (2014)';
// D: dias do mês considerados (a energia E_FV é mensal; HSP é diário)
const DIAS_PADRAO = 30;
const DIAS_MIN = 28;
const DIAS_MAX = 31;

function vazio(valor) {
  return valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '');
}

// Converte number ou string numérica ("85", "85,5") em número. Retorna NaN se inválido.
function converterNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : NaN;
  if (typeof valor === 'string') {
    const texto = valor.trim().replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(texto)) return NaN;
    return Number(texto);
  }
  return NaN;
}

function arredondar(valor) {
  return Number(valor.toFixed(2));
}

// PB02 — vazio assume 100%; rejeita não numéricos, negativos e fora de 1–100
function validarPercentual(valor) {
  if (vazio(valor)) return { valor: PERCENTUAL_PADRAO };

  const numero = converterNumero(valor);
  if (Number.isNaN(numero)) {
    return { erro: 'percentualAtendimento deve ser um número' };
  }
  if (numero < 0) {
    return { erro: 'percentualAtendimento não pode ser negativo' };
  }
  if (numero < PERCENTUAL_MIN || numero > PERCENTUAL_MAX) {
    return { erro: `percentualAtendimento deve estar entre ${PERCENTUAL_MIN}% e ${PERCENTUAL_MAX}%` };
  }
  return { valor: numero };
}

// PB01 — ajuste manual do consumo de referência (kWh/mês)
function validarConsumoManual(valor) {
  const numero = converterNumero(valor);
  if (Number.isNaN(numero)) {
    return { erro: 'consumoReferenciaKwh deve ser um número' };
  }
  if (numero <= 0) {
    return { erro: 'consumoReferenciaKwh deve ser maior que zero' };
  }
  if (numero > CONSUMO_MAX_KWH_MES) {
    return { erro: `consumoReferenciaKwh deve ser no máximo ${CONSUMO_MAX_KWH_MES} kWh/mês` };
  }
  return { valor: arredondar(numero) };
}

// PB01 — localidade do imóvel (cidade + UF)
function validarLocalidade({ cidade, uf }) {
  const cidadeLimpa = typeof cidade === 'string' ? cidade.trim() : '';
  const ufLimpa = typeof uf === 'string' ? uf.trim().toUpperCase() : '';

  if (cidadeLimpa.length < 2 || cidadeLimpa.length > 100) {
    return { erro: 'cidade deve ter entre 2 e 100 caracteres' };
  }
  if (!UFS.includes(ufLimpa)) {
    return { erro: 'uf inválida' };
  }
  return { cidade: cidadeLimpa, uf: ufLimpa };
}

// PB01 — consumo de referência sugerido a partir de dados já cadastrados:
// 1) média do histórico mensal (se houver o mínimo de meses);
// 2) senão, consumo estimado pelos eletrodomésticos do imóvel;
// 3) senão, null (fluxo bloqueado até o usuário informar manualmente).
function calcularSugestaoReferencia({ historico, consumoEstimadoKwh }) {
  const registros = (historico || []).filter((h) => h.consumoTotalKwh > 0);

  if (registros.length >= HISTORICO_MINIMO_MESES) {
    const soma = registros.reduce((acc, h) => acc + h.consumoTotalKwh, 0);
    return {
      consumoKwhMes: arredondar(soma / registros.length),
      origem: 'historico',
      mesesHistorico: registros.length
    };
  }

  if (consumoEstimadoKwh > 0) {
    return {
      consumoKwhMes: arredondar(consumoEstimadoKwh),
      origem: 'estimado',
      mesesHistorico: registros.length
    };
  }

  return null;
}

// PB01 — resolve o consumo final: manual (se informado) ou sugerido; bloqueia se nenhum.
function resolverConsumoReferencia({ consumoManual, sugestao }) {
  if (!vazio(consumoManual)) {
    const validacao = validarConsumoManual(consumoManual);
    if (validacao.erro) return { erro: validacao.erro };
    return { consumoKwhMes: validacao.valor, origem: 'manual' };
  }

  if (!sugestao) {
    return {
      erro: 'imóvel sem consumo de referência: registre o histórico, cadastre eletrodomésticos ou informe o consumo manualmente',
      codigo: 'SEM_CONSUMO_REFERENCIA'
    };
  }

  return { consumoKwhMes: sugestao.consumoKwhMes, origem: sugestao.origem };
}

// PB04 — energia mensal a gerar: E_FV = C_m × f   (f = percentual / 100)
function calcularEnergiaFv(consumoKwhMes, percentual) {
  if (!Number.isFinite(consumoKwhMes) || consumoKwhMes <= 0) {
    return { erro: 'consumo de referência (C_m) deve ser maior que zero' };
  }
  if (!Number.isFinite(percentual) || percentual < PERCENTUAL_MIN || percentual > PERCENTUAL_MAX) {
    return { erro: `percentual (f) deve estar entre ${PERCENTUAL_MIN}% e ${PERCENTUAL_MAX}%` };
  }
  return { valor: arredondar(consumoKwhMes * (percentual / 100)) };
}

// PB04 — evidência do cálculo, gravada a cada (re)cálculo para documentação
function montarLogEnergiaFv(consumoKwhMes, percentual, energiaKwhMes) {
  return {
    etapa: 'E_FV',
    formula: 'E_FV = C_m × f',
    entradas: { C_m_kWh_mes: consumoKwhMes, f_percentual: percentual, f_fracao: percentual / 100 },
    resultado: energiaKwhMes,
    unidade: 'kWh/mês'
  };
}

// PB05 — fator de desempenho (η): vazio assume o padrão; rejeita fora de ETA_MIN–ETA_MAX
function validarEta(valor) {
  if (vazio(valor)) return { valor: ETA_PADRAO };

  const numero = converterNumero(valor);
  if (Number.isNaN(numero)) {
    return { erro: 'fatorDesempenho deve ser um número' };
  }
  if (numero < ETA_MIN || numero > ETA_MAX) {
    return { erro: `fatorDesempenho deve estar entre ${ETA_MIN} e ${ETA_MAX}` };
  }
  return { valor: numero };
}

// PB05 — dias considerados (D): vazio assume 30; aceita apenas inteiros de 28 a 31
function validarDias(valor) {
  if (vazio(valor)) return { valor: DIAS_PADRAO };

  const numero = converterNumero(valor);
  if (Number.isNaN(numero) || !Number.isInteger(numero)) {
    return { erro: 'diasConsiderados deve ser um número inteiro' };
  }
  if (numero < DIAS_MIN || numero > DIAS_MAX) {
    return { erro: `diasConsiderados deve estar entre ${DIAS_MIN} e ${DIAS_MAX}` };
  }
  return { valor: numero };
}

// PB05 — potência FV necessária (kWp): P_FV = E_FV / (HSP × D × η)
// Trata divisão por zero: HSP, D, η e E_FV precisam ser finitos e > 0.
function calcularPotenciaFv({ energiaKwhMes, hsp, dias = DIAS_PADRAO, eta = ETA_PADRAO }) {
  if (!Number.isFinite(energiaKwhMes) || energiaKwhMes <= 0) {
    return { erro: 'energia mensal a gerar (E_FV) deve ser maior que zero' };
  }
  if (!Number.isFinite(hsp) || hsp <= 0) {
    return { erro: 'HSP inválido: deve ser um número maior que zero para calcular a potência FV' };
  }
  if (!Number.isFinite(dias) || dias <= 0) {
    return { erro: 'dias considerados (D) deve ser maior que zero' };
  }
  if (!Number.isFinite(eta) || eta <= 0) {
    return { erro: 'fator de desempenho (η) deve ser maior que zero' };
  }
  // 3 casas (resolução de 1 W): evita que o arredondamento altere o ceil() do PB07
  return { valor: Number((energiaKwhMes / (hsp * dias * eta)).toFixed(3)) };
}

// PB05 — evidência do cálculo da potência FV
function montarLogPotenciaFv({ energiaKwhMes, hsp, dias, eta, potenciaKwp }) {
  return {
    etapa: 'P_FV',
    formula: 'P_FV = E_FV / (HSP × D × η)',
    entradas: { E_FV_kWh_mes: energiaKwhMes, HSP_h_dia: hsp, D_dias: dias, eta },
    resultado: potenciaKwp,
    unidade: 'kWp'
  };
}

module.exports = {
  calcularEnergiaFv,
  montarLogEnergiaFv,
  calcularPotenciaFv,
  montarLogPotenciaFv,
  validarEta,
  validarDias,
  ETA_PADRAO,
  ETA_MIN,
  ETA_MAX,
  ETA_FONTE,
  DIAS_PADRAO,
  DIAS_MIN,
  DIAS_MAX,
  HISTORICO_MINIMO_MESES,
  JANELA_HISTORICO_MESES,
  CONSUMO_MAX_KWH_MES,
  PERCENTUAL_PADRAO,
  PERCENTUAL_MIN,
  PERCENTUAL_MAX,
  vazio,
  converterNumero,
  validarPercentual,
  validarConsumoManual,
  validarLocalidade,
  calcularSugestaoReferencia,
  resolverConsumoReferencia
};
