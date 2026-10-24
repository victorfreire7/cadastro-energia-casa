// PB14 — comparação entre o cenário SEM baterias e o cenário COM baterias.
// Funções puras: recebem os resultados já calculados de cada cenário (potência FV,
// módulos, inversor, geração, atendimento, armazenamento, autonomia e investimento)
// e devolvem uma tabela comparável. Nenhum equipamento ou preço é fixado aqui.

// Critérios exigidos pela PB14, na ordem de exibição.
const CRITERIOS = [
  { chave: 'potenciaFvNecessariaKwp', rotulo: 'Potência FV necessária', unidade: 'kWp', tipo: 'numero' },
  { chave: 'modulos', rotulo: 'Módulos', unidade: null, tipo: 'texto' },
  { chave: 'potenciaInstaladaKwp', rotulo: 'Potência FV instalada', unidade: 'kWp', tipo: 'numero' },
  { chave: 'inversor', rotulo: 'Inversor', unidade: null, tipo: 'texto' },
  { chave: 'geracaoMensalKwh', rotulo: 'Geração mensal estimada', unidade: 'kWh/mês', tipo: 'numero' },
  { chave: 'atendimentoPercent', rotulo: 'Atendimento do consumo', unidade: '%', tipo: 'numero' },
  { chave: 'armazenamento', rotulo: 'Armazenamento', unidade: null, tipo: 'texto' },
  { chave: 'capacidadeArmazenadaKwh', rotulo: 'Capacidade instalada de baterias', unidade: 'kWh', tipo: 'numero' },
  { chave: 'autonomiaHoras', rotulo: 'Autonomia', unidade: 'h', tipo: 'numero' },
  { chave: 'investimentoTotal', rotulo: 'Investimento total', unidade: 'R$', tipo: 'numero' }
];

function arredondar(valor) {
  return Number(valor.toFixed(2));
}

function numeroValido(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function textoValido(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

function inteiroPositivo(valor) {
  return Number.isInteger(valor) && valor > 0;
}

// Valida um cenário. `comBaterias` define se o armazenamento é obrigatório ou proibido.
function validarCenario(cenario, nome, comBaterias) {
  const erros = [];
  if (!cenario || typeof cenario !== 'object') {
    return [`cenário ${nome} não informado`];
  }

  for (const [campo, rotulo] of [
    ['potenciaFvNecessariaKwp', 'potência FV necessária'],
    ['potenciaInstaladaKwp', 'potência FV instalada']
  ]) {
    if (!numeroValido(cenario[campo]) || cenario[campo] <= 0) {
      erros.push(`cenário ${nome}: ${rotulo} deve ser um número maior que zero`);
    }
  }
  for (const [campo, rotulo] of [
    ['geracaoMensalKwh', 'geração mensal'],
    ['atendimentoPercent', 'atendimento'],
    ['investimentoTotal', 'investimento total']
  ]) {
    if (!numeroValido(cenario[campo]) || cenario[campo] < 0) {
      erros.push(`cenário ${nome}: ${rotulo} deve ser um número não negativo`);
    }
  }

  const m = cenario.modulos;
  if (!m || !textoValido(m.fabricante) || !textoValido(m.modelo) || !inteiroPositivo(m.quantidade) || !numeroValido(m.potenciaWp) || m.potenciaWp <= 0) {
    erros.push(`cenário ${nome}: módulos exigem fabricante, modelo, quantidade inteira positiva e potência (Wp)`);
  }

  const inv = cenario.inversor;
  if (!inv || !textoValido(inv.fabricante) || !textoValido(inv.modelo) || !numeroValido(inv.potenciaKw) || inv.potenciaKw <= 0) {
    erros.push(`cenário ${nome}: inversor exige fabricante, modelo e potência nominal (kW)`);
  }

  const bat = cenario.bateria;
  if (comBaterias) {
    if (!bat || !textoValido(bat.fabricante) || !textoValido(bat.modelo) || !inteiroPositivo(bat.quantidade) ||
        !numeroValido(bat.capacidadeTotalKwh) || bat.capacidadeTotalKwh <= 0) {
      erros.push(`cenário ${nome}: baterias exigem fabricante, modelo, quantidade inteira positiva e capacidade total (kWh)`);
    }
    if (!numeroValido(cenario.autonomiaHoras) || cenario.autonomiaHoras <= 0) {
      erros.push(`cenário ${nome}: autonomia deve ser maior que zero horas`);
    }
  } else if (bat) {
    erros.push(`cenário ${nome}: o cenário sem baterias não pode conter baterias`);
  }

  return erros;
}

function descreverModulos(m) {
  return `${m.quantidade} × ${m.fabricante} ${m.modelo} (${m.potenciaWp} Wp)`;
}

function descreverInversor(i) {
  return `${i.fabricante} ${i.modelo} (${i.potenciaKw} kW)`;
}

function descreverArmazenamento(b) {
  return b ? `${b.quantidade} × ${b.fabricante} ${b.modelo}` : 'Sem baterias';
}

// Extrai o valor de um critério a partir do cenário.
function valorDoCriterio(chave, cenario) {
  switch (chave) {
    case 'modulos': return descreverModulos(cenario.modulos);
    case 'inversor': return descreverInversor(cenario.inversor);
    case 'armazenamento': return descreverArmazenamento(cenario.bateria);
    case 'capacidadeArmazenadaKwh': return cenario.bateria ? cenario.bateria.capacidadeTotalKwh : 0;
    case 'autonomiaHoras': return cenario.bateria ? cenario.autonomiaHoras : 0;
    default: return cenario[chave];
  }
}

// Compara os dois cenários. Retorna { erros } se algum dado impedir a comparação;
// senão { criterios, resumo, avisos }.
function compararCenarios(entrada) {
  const { semBaterias, comBaterias } = entrada && typeof entrada === 'object' ? entrada : {};
  const erros = [
    ...validarCenario(semBaterias, 'sem baterias', false),
    ...validarCenario(comBaterias, 'com baterias', true)
  ];
  if (erros.length > 0) return { erros };

  const criterios = CRITERIOS.map((c) => {
    const sem = valorDoCriterio(c.chave, semBaterias);
    const com = valorDoCriterio(c.chave, comBaterias);
    const linha = { chave: c.chave, rotulo: c.rotulo, unidade: c.unidade, sem, com };
    if (c.tipo === 'numero') {
      linha.diferenca = arredondar(com - sem);
      // variação percentual só existe quando a base não é zero (evita divisão por zero)
      linha.diferencaPercent = sem === 0 ? null : arredondar(((com - sem) / sem) * 100);
    } else {
      linha.igual = sem === com;
    }
    return linha;
  });

  const investimentoAdicional = arredondar(comBaterias.investimentoTotal - semBaterias.investimentoTotal);
  const ganhoAtendimento = arredondar(comBaterias.atendimentoPercent - semBaterias.atendimentoPercent);
  const ganhoGeracaoKwh = arredondar(comBaterias.geracaoMensalKwh - semBaterias.geracaoMensalKwh);

  const avisos = [];
  if (investimentoAdicional < 0) {
    avisos.push('o investimento com baterias é menor que o sem baterias; confira os preços dos datasets');
  }
  if (ganhoAtendimento <= 0) {
    avisos.push('as baterias não aumentaram o percentual de atendimento neste cenário');
  }

  return {
    criterios,
    resumo: {
      investimentoAdicional,
      ganhoAtendimentoPontosPercentuais: ganhoAtendimento,
      ganhoGeracaoKwhMes: ganhoGeracaoKwh,
      // custo de cada ponto percentual ganho; indefinido quando não há ganho
      investimentoPorPontoPercentual: ganhoAtendimento > 0 ? arredondar(investimentoAdicional / ganhoAtendimento) : null
    },
    avisos
  };
}

module.exports = { CRITERIOS, validarCenario, compararCenarios };
