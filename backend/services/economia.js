// PB15 — estimativa de economia: Economia_mensal = E_compensada × tarifa.
// Funções puras. A tarifa é informada com sua fonte (não há preço fixado no código).

const TARIFA_MAX_REAIS_KWH = 10; // teto de sanidade para evitar valores digitados errados
const MESES_ANO = 12;

function arredondar(valor, casas = 2) {
  return Number(valor.toFixed(casas));
}

function numeroValido(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

// Valida as entradas. Retorna lista de mensagens (vazia quando válido).
function validarEntradas(entrada) {
  const { tarifaReaisKwh, tarifaFonte, energiaGeradaKwhMes, consumoKwhMes, energiaCompensadaKwhMes } = entrada && typeof entrada === 'object' ? entrada : {};
  const erros = [];
  if (!numeroValido(tarifaReaisKwh) || tarifaReaisKwh <= 0) {
    erros.push('tarifa deve ser um número maior que zero (R$/kWh)');
  } else if (tarifaReaisKwh > TARIFA_MAX_REAIS_KWH) {
    erros.push(`tarifa acima de R$ ${TARIFA_MAX_REAIS_KWH}/kWh parece incorreta; confira a unidade (R$/kWh, não R$/MWh)`);
  }
  if (typeof tarifaFonte !== 'string' || tarifaFonte.trim() === '') {
    erros.push('informe a fonte da tarifa (ex.: fatura da distribuidora ou tarifa homologada pela ANEEL)');
  }
  if (!numeroValido(energiaGeradaKwhMes) || energiaGeradaKwhMes < 0) {
    erros.push('energia gerada mensal deve ser um número não negativo (kWh/mês)');
  }
  if (!numeroValido(consumoKwhMes) || consumoKwhMes <= 0) {
    erros.push('consumo mensal deve ser um número maior que zero (kWh/mês)');
  }
  if (energiaCompensadaKwhMes !== undefined && energiaCompensadaKwhMes !== null) {
    if (!numeroValido(energiaCompensadaKwhMes) || energiaCompensadaKwhMes < 0) {
      erros.push('energia compensada deve ser um número não negativo (kWh/mês)');
    } else if (numeroValido(energiaGeradaKwhMes) && energiaCompensadaKwhMes > energiaGeradaKwhMes) {
      erros.push('energia compensada não pode ser maior que a energia gerada');
    } else if (numeroValido(consumoKwhMes) && energiaCompensadaKwhMes > consumoKwhMes) {
      erros.push('energia compensada não pode ser maior que o consumo');
    }
  }
  return erros;
}

// Calcula a economia. Energia compensada = menor valor entre geração e consumo,
// a menos que seja informada diretamente (ex.: resultado da comparação geração × consumo).
function calcularEconomia(entrada) {
  const erros = validarEntradas(entrada);
  if (erros.length > 0) return { erros };

  const { tarifaReaisKwh, tarifaFonte, energiaGeradaKwhMes, consumoKwhMes } = entrada;
  const informada = entrada.energiaCompensadaKwhMes !== undefined && entrada.energiaCompensadaKwhMes !== null;
  const compensada = informada
    ? entrada.energiaCompensadaKwhMes
    : Math.min(energiaGeradaKwhMes, consumoKwhMes);

  const economiaMensal = compensada * tarifaReaisKwh;
  const excedente = Math.max(0, energiaGeradaKwhMes - compensada);

  const premissas = [
    `Tarifa considerada: R$ ${tarifaReaisKwh.toFixed(4)}/kWh (fonte: ${tarifaFonte.trim()}).`,
    informada
      ? 'Energia compensada informada pelo usuário/cálculo anterior.'
      : 'Energia compensada = menor valor entre a geração mensal e o consumo mensal.',
    'O excedente de geração não gera crédito financeiro nesta estimativa.',
    'Tarifa constante nos 12 meses, sem reajuste, bandeiras tarifárias, impostos adicionais, taxa mínima ou custo de disponibilidade.',
    'Geração mensal constante ao longo do ano (sem sazonalidade nem degradação dos módulos).',
    'Valores estimados, sem caráter de previsão financeira exata.'
  ];

  return {
    tarifa: { valorReaisKwh: tarifaReaisKwh, fonte: tarifaFonte.trim() },
    energiaGeradaKwhMes: arredondar(energiaGeradaKwhMes),
    consumoKwhMes: arredondar(consumoKwhMes),
    energiaCompensadaKwhMes: arredondar(compensada),
    energiaExcedenteKwhMes: arredondar(excedente),
    economiaMensal: arredondar(economiaMensal),
    economiaAnual: arredondar(economiaMensal * MESES_ANO),
    memoriaCalculo: {
      formula: 'Economia_mensal = E_compensada × tarifa',
      entradas: { E_compensada_kWh_mes: arredondar(compensada), tarifa_R$_kWh: tarifaReaisKwh },
      resultado: arredondar(economiaMensal),
      unidade: 'R$/mês'
    },
    premissas
  };
}

module.exports = { TARIFA_MAX_REAIS_KWH, MESES_ANO, validarEntradas, calcularEconomia };
