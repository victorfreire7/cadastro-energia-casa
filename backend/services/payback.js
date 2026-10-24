// PB16 — payback simples: Payback = Investimento / Economia_anual.
// Funções puras. O resultado é sempre rotulado como "payback simples" e como estimativa.

const MESES_ANO = 12;
// Acima deste prazo o retorno pode superar a vida útil típica de um sistema fotovoltaico.
const PRAZO_ALERTA_ANOS = 25;

function arredondar(valor, casas = 2) {
  return Number(valor.toFixed(casas));
}

function numeroValido(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function validarEntradas(entrada) {
  const { investimentoTotal, economiaAnual } = entrada && typeof entrada === 'object' ? entrada : {};
  const erros = [];
  if (!numeroValido(investimentoTotal) || investimentoTotal <= 0) {
    erros.push('investimento deve ser um número maior que zero (R$)');
  }
  if (!numeroValido(economiaAnual) || economiaAnual < 0) {
    erros.push('economia anual deve ser um número não negativo (R$/ano)');
  }
  return erros;
}

// Economia anual zero: não há retorno; devolve payback indefinido (null), sem dividir por zero.
function calcularPayback(entrada) {
  const erros = validarEntradas(entrada);
  if (erros.length > 0) return { erros };

  const { investimentoTotal, economiaAnual } = entrada;

  const premissas = [
    'Payback simples: não considera juros, inflação, reajuste de tarifa, degradação dos módulos nem custos de manutenção.',
    'Economia anual constante em todos os anos.',
    'Resultado estimado, não é previsão financeira exata.'
  ];

  const base = {
    tipo: 'payback simples',
    investimentoTotal: arredondar(investimentoTotal),
    economiaAnual: arredondar(economiaAnual),
    premissas
  };

  if (economiaAnual === 0) {
    return {
      ...base,
      paybackAnos: null,
      paybackMeses: null,
      descricao: 'Payback simples indefinido: a economia anual estimada é zero, então o investimento não é recuperado.',
      memoriaCalculo: {
        formula: 'Payback = Investimento / Economia_anual',
        entradas: { Investimento_R$: arredondar(investimentoTotal), Economia_anual_R$_ano: 0 },
        resultado: null,
        unidade: 'anos'
      },
      avisos: ['economia anual igual a zero: não há retorno do investimento']
    };
  }

  const anos = investimentoTotal / economiaAnual;
  const mesesTotais = Math.ceil(anos * MESES_ANO - 1e-9);
  const anosInteiros = Math.floor(mesesTotais / MESES_ANO);
  const mesesRestantes = mesesTotais % MESES_ANO;

  const avisos = [];
  if (anos > PRAZO_ALERTA_ANOS) {
    avisos.push(`payback simples acima de ${PRAZO_ALERTA_ANOS} anos: o retorno pode superar a vida útil típica do sistema`);
  }

  return {
    ...base,
    paybackAnos: arredondar(anos),
    paybackMeses: mesesTotais,
    descricao: `Payback simples estimado em ${arredondar(anos)} anos (${anosInteiros} anos e ${mesesRestantes} meses).`,
    memoriaCalculo: {
      formula: 'Payback = Investimento / Economia_anual',
      entradas: { Investimento_R$: arredondar(investimentoTotal), Economia_anual_R$_ano: arredondar(economiaAnual) },
      resultado: arredondar(anos),
      unidade: 'anos'
    },
    avisos
  };
}

module.exports = { PRAZO_ALERTA_ANOS, validarEntradas, calcularPayback };
