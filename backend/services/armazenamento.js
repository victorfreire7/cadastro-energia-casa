const { vazio, converterNumero } = require('./dimensionamento');

// PB12 — faixa plausível da autonomia desejada (horas)
const AUTONOMIA_MIN_H = 1;
const AUTONOMIA_MAX_H = 72;

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

module.exports = {
  AUTONOMIA_MIN_H,
  AUTONOMIA_MAX_H,
  validarAutonomia,
  resolverArmazenamento,
  custoBateria
};
