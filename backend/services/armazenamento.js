const { vazio, converterNumero, arredondar } = require('./dimensionamento');

// PB12 — faixa plausível da autonomia desejada (horas)
const AUTONOMIA_MIN_H = 1;
const AUTONOMIA_MAX_H = 72;
// PB13 — valores padrão documentados para estimar a capacidade nominal requerida.
const DOD_PADRAO = 0.8;
const EFICIENCIA_BATERIA_PADRAO = 0.9;

function validarAutonomia(valor) {
  const numero = converterNumero(valor);
  if (Number.isNaN(numero)) {
    return { erro: 'autonomiaHoras deve ser um número' };
  }
  if (numero <= 0) {
    return { erro: 'autonomiaHoras deve ser um valor positivo' };
  }
  if (numero < AUTONOMIA_MIN_H || numero > AUTONOMIA_MAX_H) {
    return { erro: `autonomiaHoras deve estar entre ${AUTONOMIA_MIN_H} e ${AUTONOMIA_MAX_H} horas` };
  }
  return { valor: numero };
}

// PB11 — escolha explícita com/sem baterias (padrão: sem)
// PB12 — autonomia obrigatória só quando há armazenamento; sem armazenamento ela é descartada
function resolverArmazenamento({ armazenamento, autonomiaHoras }) {
  const ativo = vazio(armazenamento) ? false : armazenamento;
  if (typeof ativo !== 'boolean') {
    return { erro: 'armazenamento deve ser true (com baterias) ou false (sem baterias)' };
  }

  if (!ativo) {
    return { armazenamento: false, autonomiaHoras: null };
  }

  if (vazio(autonomiaHoras)) {
    return { erro: 'autonomiaHoras é obrigatória quando há armazenamento por baterias' };
  }
  const autonomia = validarAutonomia(autonomiaHoras);
  if (autonomia.erro) return { erro: autonomia.erro };

  return { armazenamento: true, autonomiaHoras: autonomia.valor };
}

// PB11 — sem armazenamento, o custo de baterias é sempre zero
function custoBateria(armazenamento, custoCalculadoBrl = 0) {
  return armazenamento ? custoCalculadoBrl : 0;
}

// PB13 — C_m é o consumo de referência mensal salvo no cenário.
function calcularCapacidadeBateria(
  consumoKwhMes,
  autonomiaHoras,
  dod = DOD_PADRAO,
  eficiencia = EFICIENCIA_BATERIA_PADRAO
) {
  const entradas = { consumoKwhMes, autonomiaHoras, dod, eficiencia };
  for (const [campo, valor] of Object.entries(entradas)) {
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
      return { erro: `${campo} deve ser um número maior que zero` };
    }
  }
  if (dod > 1 || eficiencia > 1) {
    return { erro: 'dod e eficiencia devem estar entre 0 e 1' };
  }
  if (autonomiaHoras < AUTONOMIA_MIN_H || autonomiaHoras > AUTONOMIA_MAX_H) {
    return { erro: `autonomiaHoras deve estar entre ${AUTONOMIA_MIN_H} e ${AUTONOMIA_MAX_H} horas` };
  }

  const energiaDiariaKwh = consumoKwhMes / 30;
  const energiaAutonomiaKwh = energiaDiariaKwh * (autonomiaHoras / 24);
  const capacidadeNecessariaKwh = energiaAutonomiaKwh / (dod * eficiencia);
  return {
    energiaDiariaKwh: arredondar(energiaDiariaKwh),
    energiaAutonomiaKwh: arredondar(energiaAutonomiaKwh),
    capacidadeNecessariaKwh: arredondar(capacidadeNecessariaKwh),
    dod,
    eficiencia
  };
}

function montarLogCapacidadeBateria(consumoKwhMes, autonomiaHoras, resultado) {
  return {
    etapa: 'CAPACIDADE_BATERIA',
    formula: 'E_d = C_m / 30; E_autonomia = E_d × (A / 24); C_bat = E_autonomia / (DoD × η_bat)',
    entradas: {
      C_m_kWh_mes: consumoKwhMes,
      A_horas: autonomiaHoras,
      E_d_kWh_dia: resultado.energiaDiariaKwh,
      E_autonomia_kWh: resultado.energiaAutonomiaKwh,
      DoD: resultado.dod,
      eficiencia_bateria: resultado.eficiencia
    },
    resultado: resultado.capacidadeNecessariaKwh,
    unidade: 'kWh'
  };
}

module.exports = {
  AUTONOMIA_MIN_H,
  AUTONOMIA_MAX_H,
  DOD_PADRAO,
  EFICIENCIA_BATERIA_PADRAO,
  validarAutonomia,
  resolverArmazenamento,
  custoBateria,
  calcularCapacidadeBateria,
  montarLogCapacidadeBateria
};
