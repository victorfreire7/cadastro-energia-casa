const { converterNumero, vazio } = require('./dimensionamento');

// PB08 — a partir de que desvio entre P_instalada e P_FV o usuário é alertado (±%)
const LIMITE_ALERTA_PCT = 10;

// PB07 — N = ceil((P_FV × 1000) / P_módulo)
// O quociente é arredondado a 6 casas antes do ceil para que ruído de ponto flutuante
// (ex.: 0,55 × 1000 = 550,00000000000006) não some um módulo a mais.
function calcularQuantidadeModulos(potenciaFvKwp, potenciaModuloWp) {
  if (!Number.isFinite(potenciaFvKwp) || potenciaFvKwp <= 0) {
    return { erro: 'potência FV necessária (P_FV) deve ser maior que zero' };
  }
  if (!Number.isFinite(potenciaModuloWp) || potenciaModuloWp <= 0) {
    return { erro: 'potência do módulo deve ser maior que zero' };
  }
  const quociente = Number(((potenciaFvKwp * 1000) / potenciaModuloWp).toFixed(6));
  return { valor: Math.max(1, Math.ceil(quociente)) };
}

// PB08 — P_instalada = (N × P_módulo) / 1000   (kWp)
function calcularPotenciaInstalada(quantidade, potenciaModuloWp) {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return { erro: 'quantidade de módulos (N) deve ser um inteiro maior que zero' };
  }
  if (!Number.isFinite(potenciaModuloWp) || potenciaModuloWp <= 0) {
    return { erro: 'potência do módulo deve ser maior que zero' };
  }
  return { valor: Number(((quantidade * potenciaModuloWp) / 1000).toFixed(3)) };
}

// PB08 — compara P_instalada com P_FV e classifica: ok | folga | deficit
function compararPotencias(potenciaInstaladaKwp, potenciaFvKwp, limitePct = LIMITE_ALERTA_PCT) {
  const diferencaKwp = Number((potenciaInstaladaKwp - potenciaFvKwp).toFixed(3));
  const desvioPct = Number((((potenciaInstaladaKwp - potenciaFvKwp) / potenciaFvKwp) * 100).toFixed(1));

  let status = 'ok';
  let mensagem = null;
  if (desvioPct > limitePct) {
    status = 'folga';
    mensagem = `Potência instalada ${desvioPct}% acima da necessária (folga de ${diferencaKwp} kWp): o sistema vai gerar mais do que o percentual desejado. Considere outro módulo.`;
  } else if (desvioPct < -limitePct) {
    status = 'deficit';
    mensagem = `Potência instalada ${Math.abs(desvioPct)}% abaixo da necessária (déficit de ${Math.abs(diferencaKwp)} kWp): o sistema não atenderá o percentual desejado.`;
  }
  return { potenciaFvKwp, potenciaInstaladaKwp, diferencaKwp, desvioPct, limiteAlertaPct: limitePct, status, mensagem };
}

// Calcula N, P_instalada, comparação e custo de um módulo para um dado P_FV
function avaliarModulo(painel, potenciaFvKwp) {
  const n = calcularQuantidadeModulos(potenciaFvKwp, painel.potenciaWp);
  if (n.erro) return { erro: n.erro };
  const instalada = calcularPotenciaInstalada(n.valor, painel.potenciaWp);
  if (instalada.erro) return { erro: instalada.erro };
  return {
    painel,
    quantidade: n.valor,
    potenciaInstaladaKwp: instalada.valor,
    custoModulosBrl: Number((n.valor * painel.precoBrl).toFixed(2)),
    comparacao: compararPotencias(instalada.valor, potenciaFvKwp)
  };
}

// PB07 — seleção automática: menor custo total dos módulos; empate → maior eficiência → menor id
function selecionarModuloPadrao(paineis, potenciaFvKwp) {
  const avaliados = paineis.map((p) => avaliarModulo(p, potenciaFvKwp)).filter((a) => !a.erro);
  if (avaliados.length === 0) return null;
  avaliados.sort(
    (a, b) =>
      a.custoModulosBrl - b.custoModulosBrl ||
      b.painel.eficienciaPct - a.painel.eficienciaPct ||
      a.painel.id - b.painel.id
  );
  return avaliados[0];
}

// PB07 — todas as opções do dataset já calculadas, com a sugerida marcada
function listarOpcoes(paineis, potenciaFvKwp) {
  const padrao = selecionarModuloPadrao(paineis, potenciaFvKwp);
  const opcoes = paineis
    .map((p) => avaliarModulo(p, potenciaFvKwp))
    .filter((a) => !a.erro)
    .map((a) => ({
      moduloId: a.painel.id,
      fabricante: a.painel.fabricante,
      modelo: a.painel.modelo,
      potenciaWp: a.painel.potenciaWp,
      eficienciaPct: a.painel.eficienciaPct,
      precoBrl: a.painel.precoBrl,
      quantidade: a.quantidade,
      potenciaInstaladaKwp: a.potenciaInstaladaKwp,
      custoModulosBrl: a.custoModulosBrl,
      comparacao: a.comparacao
    }));
  return { padraoId: padrao ? padrao.painel.id : null, opcoes };
}

// PB07 — valida o módulo escolhido (id numérico + existe no dataset) ou cai na seleção automática.
// Retorna { avaliacao, origem: 'manual' | 'automatica' } ou { erro }.
function resolverModulo({ moduloId, paineis, obterPainel, potenciaFvKwp }) {
  let painel;
  let origem;
  if (vazio(moduloId)) {
    const padrao = selecionarModuloPadrao(paineis, potenciaFvKwp);
    if (!padrao) return { erro: 'nenhum módulo disponível no dataset' };
    painel = padrao.painel;
    origem = 'automatica';
  } else {
    const id = converterNumero(moduloId);
    if (!Number.isInteger(id) || id <= 0) {
      return { erro: 'moduloId deve ser um inteiro positivo' };
    }
    painel = obterPainel(id);
    if (!painel) {
      return { erro: 'módulo selecionado não existe no dataset' };
    }
    origem = 'manual';
  }

  const avaliacao = avaliarModulo(painel, potenciaFvKwp);
  if (avaliacao.erro) return { erro: avaliacao.erro };
  return { avaliacao, origem };
}

// Evidências de cálculo (memória de cálculo)
function montarLogQuantidadeModulos({ potenciaFvKwp, painel, quantidade }) {
  return {
    etapa: 'N_MODULOS',
    formula: 'N = ⌈(P_FV × 1000) / P_módulo⌉',
    entradas: {
      P_FV_kWp: potenciaFvKwp,
      P_modulo_Wp: painel.potenciaWp,
      modulo: `${painel.fabricante} ${painel.modelo}`,
      moduloId: painel.id
    },
    resultado: quantidade,
    unidade: 'módulos'
  };
}

function montarLogPotenciaInstalada({ quantidade, painel, potenciaInstaladaKwp, comparacao }) {
  return {
    etapa: 'P_INSTALADA',
    formula: 'P_instalada = (N × P_módulo) / 1000',
    entradas: {
      N: quantidade,
      P_modulo_Wp: painel.potenciaWp,
      P_FV_kWp: comparacao.potenciaFvKwp,
      desvio_pct: comparacao.desvioPct,
      status: comparacao.status
    },
    resultado: potenciaInstaladaKwp,
    unidade: 'kWp'
  };
}

module.exports = {
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
};
