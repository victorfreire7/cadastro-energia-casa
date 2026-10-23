const prisma = require('../prisma/client');
const { calcularConsumoEletrodomestico } = require('./consumoController');
const {
  HISTORICO_MINIMO_MESES,
  JANELA_HISTORICO_MESES,
  PERCENTUAL_PADRAO,
  vazio,
  validarPercentual,
  validarLocalidade,
  calcularSugestaoReferencia,
  resolverConsumoReferencia,
  calcularEnergiaFv,
  montarLogEnergiaFv
} = require('../services/dimensionamento');
const { HSP_MIN, HSP_MAX, tabelaHsp, obterHspPorUf, resolverHsp } = require('../services/hsp');
const {
  resolverArmazenamento,
  custoBateria,
  DOD_PADRAO,
  EFICIENCIA_BATERIA_PADRAO,
  calcularCapacidadeBateria,
  montarLogCapacidadeBateria
} = require('../services/armazenamento');
const {
  bateriasDisponiveis,
  selecionarBateria,
  dimensionarBaterias,
  montarLogSelecaoBateria
} = require('../services/baterias');
const { paineisDisponiveis, dimensionarSistema } = require('../services/paineis');
const { inversoresDisponiveis, selecionarInversoresCompativeis, escolherInversor } = require('../services/inversores');
const { calcularGeracaoFotovoltaica } = require('../services/geracaoFotovoltaica');

async function buscarImovelDoUsuario(id, usuarioId) {
  return prisma.imovel.findFirst({
    where: { id: Number(id), usuarioId },
    include: { eletrodomesticos: true }
  });
}

// PB01 — reaproveita dados já cadastrados (histórico mensal + eletrodomésticos)
async function obterSugestao(imovel) {
  const historico = await prisma.consumoHistorico.findMany({
    where: { imovelId: imovel.id },
    orderBy: { mesReferencia: 'desc' },
    take: JANELA_HISTORICO_MESES
  });

  const consumoEstimadoKwh = imovel.eletrodomesticos.reduce(
    (soma, e) => soma + calcularConsumoEletrodomestico(e),
    0
  );

  return calcularSugestaoReferencia({ historico, consumoEstimadoKwh });
}

function hspPublico(registro) {
  if (!registro) return null;
  return { uf: registro.uf, regiao: registro.regiao, hsp: registro.hsp, fonte: registro.fonte };
}

function bateriaPublica(bateria) {
  return {
    id: bateria.id,
    fabricante: bateria.fabricante,
    modelo: bateria.modelo,
    tecnologia: bateria.tecnologia,
    capacidadeKwh: bateria.capacidadeKwh,
    dod: bateria.dod,
    dodPercentual: bateria.dodPercentual,
    tensaoV: bateria.tensaoV,
    precoBrl: bateria.precoBrl,
    dataConsulta: bateria.dataConsulta,
    fonte: bateria.fonte
  };
}

function consultarBaterias(req, res) {
  res.json({
    padroes: { dod: DOD_PADRAO, eficiencia: EFICIENCIA_BATERIA_PADRAO },
    baterias: bateriasDisponiveis().map(bateriaPublica)
  });
}

function consultarPaineis(req, res) {
  res.json({ diasReferencia: 30, eficienciaPadrao: 0.75, paineis: paineisDisponiveis() });
}

function consultarInversores(req, res) {
  res.json({ inversores: inversoresDisponiveis() });
}

function consultarInversoresCompativeis(req, res) {
  const painel = paineisDisponiveis().find((item) => item.id === Number(req.query.painelId));
  const quantidade = Number(req.query.quantidade);
  if (!painel) return res.status(400).json({ message: 'selecione um módulo válido' });
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return res.status(400).json({ message: 'quantidade de módulos deve ser um inteiro maior que zero' });
  }

  // Esta etapa avalia uma string com todos os módulos em série.
  const arranjo = {
    quantidadeModulos: quantidade,
    potenciaInstaladaKwp: Number(((painel.potenciaWp * quantidade) / 1000).toFixed(3)),
    tensaoStringVocV: Number((painel.vocV * quantidade).toFixed(2)),
    tensaoStringMppV: Number((painel.vmpV * quantidade).toFixed(2)),
    correnteModuloA: painel.correnteA,
    configuracao: 'todos os módulos em uma string série'
  };
  const resultado = selecionarInversoresCompativeis(arranjo);
  res.json({
    arranjo,
    compativeis: resultado.compativeis || [],
    rejeitados: resultado.rejeitados || [],
    ...(resultado.erro && { message: resultado.erro })
  });
}

function adicionarResultadosDeGeracao(cenario) {
  if (!cenario.potenciaInstaladaKwp || !cenario.hspKwhM2Dia || !cenario.eficienciaSistema) return cenario;
  const resultado = calcularGeracaoFotovoltaica({
    potenciaInstaladaKwp: cenario.potenciaInstaladaKwp,
    hsp: cenario.hspKwhM2Dia,
    pr: cenario.eficienciaSistema,
    consumoMensalKwh: cenario.consumoReferenciaKwh
  });
  return resultado.erro ? cenario : { ...cenario, ...resultado };
}

function resolverOrcamento(body, energiaMensalKwh, hsp, armazenamento, bateriaId, defaults = {}) {
  const painelId = body.painelId ?? defaults.painelId;
  const inversorId = body.inversorId ?? defaults.inversorId;
  const eficienciaSistema = body.eficienciaSistema === undefined ? (defaults.eficienciaSistema ?? 0.75) : Number(body.eficienciaSistema);
  const diasReferencia = body.diasReferencia === undefined ? (defaults.diasReferencia ?? 30) : Number(body.diasReferencia);
  const custos = {};
  for (const chave of ['custoEstruturaBrl', 'custoCabeamentoBrl', 'custoProtecoesBrl', 'custoInstalacaoBrl']) {
    const valor = body[chave] === undefined ? (defaults[chave] ?? 0) : Number(body[chave]);
    if (!Number.isFinite(valor) || valor < 0) return { erro: `${chave} deve ser um número igual ou maior que zero` };
    custos[chave] = Number(valor.toFixed(2));
  }
  if (!Number.isFinite(eficienciaSistema) || eficienciaSistema <= 0 || eficienciaSistema > 1) return { erro: 'eficienciaSistema deve estar entre 0 e 1' };
  if (!Number.isInteger(diasReferencia) || diasReferencia < 1 || diasReferencia > 31) return { erro: 'diasReferencia deve estar entre 1 e 31' };

  let painel = null;
  let inversor = null;
  let custoPaineisBrl = 0;
  let quantidadePaineis = null;
  let potenciaSistemaKwp = null;
  let potenciaInstaladaKwp = null;
  let log = null;
  const temDimensionamento = painelId !== undefined && painelId !== null && inversorId !== undefined && inversorId !== null;
  if (temDimensionamento) {
    const potencia = dimensionarSistema({ energiaMensalKwh, hsp, eficiencia: eficienciaSistema, diasReferencia, painelId });
    if (potencia.erro) return potencia;
    painel = potencia.painel;
    inversor = inversoresDisponiveis().find((item) => item.id === Number(inversorId));
    if (!inversor) return { erro: 'inversor não encontrado' };
    const entradaInversor = {
      potenciaInstaladaKwp: potencia.potenciaInstaladaKwp,
      tensaoStringVocV: painel.vocV * potencia.quantidade,
      tensaoStringMppV: painel.vmpV * potencia.quantidade,
      correnteModuloA: painel.correnteA
    };
    const validacaoInversor = escolherInversor(inversorId, entradaInversor);
    if (validacaoInversor.erro) {
      const alternativas = selecionarInversoresCompativeis(entradaInversor);
      return {
        erro: validacaoInversor.erro,
        alternativas: (alternativas.compativeis || []).map(({ id, fabricante, modelo }) => ({ id, fabricante, modelo }))
      };
    }
    if (armazenamento) {
      const bateria = bateriasDisponiveis().find((item) => item.id === Number(bateriaId));
      const familia = bateria ? `${bateria.fabricante} ${bateria.modelo}` : '';
      if (!inversor.suportaBateria || !inversor.bateriasCompativeis.some((nome) => familia.includes(nome))) {
        const alternativas = inversoresDisponiveis().filter((item) => item.suportaBateria && item.bateriasCompativeis.some((nome) => familia.includes(nome)));
        return { erro: `inversor selecionado não suporta a bateria ${familia || 'selecionada'}`, alternativas: alternativas.map(({ id, fabricante, modelo }) => ({ id, fabricante, modelo })) };
      }
    }
    custoPaineisBrl = potencia.custoPaineisBrl;
    quantidadePaineis = potencia.quantidade;
    potenciaSistemaKwp = potencia.potenciaNecessariaKwp;
    potenciaInstaladaKwp = potencia.potenciaInstaladaKwp;
    log = potencia.log;
  } else if (painelId !== undefined || inversorId !== undefined) {
    return { erro: 'selecione painel e inversor para dimensionar o sistema' };
  }

  const custoInversorBrl = inversor ? inversor.precoBrl : 0;
  const custoBateriaBrl = armazenamento ? Number(defaults.custoBateriaBrl || 0) : 0;
  const custoEquipamentosBrl = Number((custoPaineisBrl + custoInversorBrl + custoBateriaBrl).toFixed(2));
  const custoTotalBrl = Number((custoEquipamentosBrl + Object.values(custos).reduce((a, b) => a + b, 0)).toFixed(2));
  return { dados: { painelId: painel?.id ?? null, quantidadePaineis, potenciaSistemaKwp, potenciaInstaladaKwp, eficienciaSistema, diasReferencia, inversorId: inversor?.id ?? null, custoPaineisBrl, custoInversorBrl, ...custos, fontesCustosComplementares: body.fontesCustosComplementares ?? defaults.fontesCustosComplementares ?? null, custoEquipamentosBrl, custoTotalBrl }, painel, inversor, log };
}

function resolverDimensionamentoBateria({ consumoKwhMes, armazenamento, autonomiaHoras, bateriaId, permitirSemSelecao = false }) {
  if (!armazenamento) {
    return {
      dados: {
        capacidadeBateriaNecessariaKwh: null,
        bateriaId: null,
        quantidadeBaterias: 0,
        capacidadeBateriaInstaladaKwh: 0,
        custoBateriaBrl: 0
      },
      logs: []
    };
  }

  const capacidade = calcularCapacidadeBateria(
    consumoKwhMes,
    autonomiaHoras,
    DOD_PADRAO,
    EFICIENCIA_BATERIA_PADRAO
  );
  if (capacidade.erro) return capacidade;
  const logCapacidade = montarLogCapacidadeBateria(consumoKwhMes, autonomiaHoras, capacidade);

  if (vazio(bateriaId)) {
    if (!permitirSemSelecao) return { erro: 'bateriaId é obrigatória quando há armazenamento' };
    return {
      dados: {
        capacidadeBateriaNecessariaKwh: capacidade.capacidadeNecessariaKwh,
        bateriaId: null,
        quantidadeBaterias: null,
        capacidadeBateriaInstaladaKwh: null,
        custoBateriaBrl: 0
      },
      logs: [logCapacidade]
    };
  }

  const selecionada = selecionarBateria(bateriaId);
  if (selecionada.erro) return selecionada;
  const energiaAutonomiaKwhExata = (consumoKwhMes / 30) * (autonomiaHoras / 24);
  const dimensionamento = dimensionarBaterias({
    bateria: selecionada.bateria,
    energiaAutonomiaKwh: energiaAutonomiaKwhExata,
    eficiencia: EFICIENCIA_BATERIA_PADRAO
  });
  if (dimensionamento.erro) return dimensionamento;
  return {
    dados: {
      capacidadeBateriaNecessariaKwh: capacidade.capacidadeNecessariaKwh,
      bateriaId: dimensionamento.bateria.id,
      quantidadeBaterias: dimensionamento.quantidade,
      capacidadeBateriaInstaladaKwh: dimensionamento.capacidadeInstaladaKwh,
      custoBateriaBrl: custoBateria(true, dimensionamento.custoBrl)
    },
    logs: [logCapacidade, montarLogSelecaoBateria(dimensionamento, energiaAutonomiaKwhExata, EFICIENCIA_BATERIA_PADRAO)]
  };
}

// GET /dimensionamento/hsp?uf=SP (sem uf: devolve a tabela completa)
async function consultarHsp(req, res) {
  const { uf } = req.query;
  const faixa = { min: HSP_MIN, max: HSP_MAX };

  if (!uf) {
    return res.json({ faixa, tabela: [...tabelaHsp().values()].map(hspPublico) });
  }

  const registro = obterHspPorUf(uf);
  if (!registro) {
    return res.status(404).json({ message: 'não há HSP cadastrado para esta UF' });
  }
  res.json({ ...hspPublico(registro), faixa });
}

// GET /imoveis/:id/dimensionamento/referencia
async function referencia(req, res) {
  const imovel = await buscarImovelDoUsuario(req.params.id, req.usuarioId);
  if (!imovel) {
    return res.status(404).json({ message: 'imóvel não encontrado' });
  }

  const sugestao = await obterSugestao(imovel);

  res.json({
    imovelId: imovel.id,
    endereco: imovel.endereco,
    localidade: { cidade: imovel.cidade, uf: imovel.uf },
    sugestao,
    hsp: imovel.uf ? hspPublico(obterHspPorUf(imovel.uf)) : null,
    faixaHsp: { min: HSP_MIN, max: HSP_MAX },
    historicoMinimoMeses: HISTORICO_MINIMO_MESES,
    percentualPadrao: PERCENTUAL_PADRAO,
    // PB01: sem consumo de referência definido, o fluxo fica bloqueado
    // (a menos que o usuário informe o consumo manualmente)
    podeAvancar: sugestao !== null
  });
}

// POST /imoveis/:id/cenarios
async function criar(req, res) {
  const imovel = await buscarImovelDoUsuario(req.params.id, req.usuarioId);
  if (!imovel) {
    return res.status(404).json({ message: 'imóvel não encontrado' });
  }

  const { consumoReferenciaKwh, percentualAtendimento } = req.body;

  const localidade = validarLocalidade({
    cidade: req.body.cidade ?? imovel.cidade,
    uf: req.body.uf ?? imovel.uf
  });
  if (localidade.erro) {
    return res.status(400).json({ message: localidade.erro });
  }

  const sugestao = await obterSugestao(imovel);
  const consumo = resolverConsumoReferencia({ consumoManual: consumoReferenciaKwh, sugestao });
  if (consumo.erro) {
    return res.status(400).json({ message: consumo.erro, ...(consumo.codigo && { codigo: consumo.codigo }) });
  }

  const percentual = validarPercentual(percentualAtendimento);
  if (percentual.erro) {
    return res.status(400).json({ message: percentual.erro });
  }

  const hsp = resolverHsp({ uf: localidade.uf, hspManual: req.body.hspKwhM2Dia });
  if (hsp.erro) {
    return res.status(400).json({ message: hsp.erro });
  }

  const armazenamento = resolverArmazenamento({
    armazenamento: req.body.armazenamento,
    autonomiaHoras: req.body.autonomiaHoras
  });
  if (armazenamento.erro) {
    return res.status(400).json({ message: armazenamento.erro });
  }

  const dimensionamentoBateria = resolverDimensionamentoBateria({
    consumoKwhMes: consumo.consumoKwhMes,
    armazenamento: armazenamento.armazenamento,
    autonomiaHoras: armazenamento.autonomiaHoras,
    bateriaId: req.body.bateriaId
  });
  if (dimensionamentoBateria.erro) {
    return res.status(400).json({ message: dimensionamentoBateria.erro });
  }

  const energia = calcularEnergiaFv(consumo.consumoKwhMes, percentual.valor);
  if (energia.erro) {
    return res.status(400).json({ message: energia.erro });
  }
  const orcamento = resolverOrcamento(req.body, energia.valor, hsp.hsp, armazenamento.armazenamento, req.body.bateriaId, {
    custoBateriaBrl: dimensionamentoBateria.dados.custoBateriaBrl
  });
  if (orcamento.erro) return res.status(400).json({ message: orcamento.erro, alternativas: orcamento.alternativas || [] });

  const cenario = await prisma.cenarioDimensionamento.create({
    data: {
      imovelId: imovel.id,
      cidade: localidade.cidade,
      uf: localidade.uf,
      consumoReferenciaKwh: consumo.consumoKwhMes,
      consumoOrigem: consumo.origem,
      percentualAtendimento: percentual.valor,
      hspKwhM2Dia: hsp.hsp,
      hspOrigem: hsp.origem,
      hspFonte: hsp.fonte,
      armazenamento: armazenamento.armazenamento,
      autonomiaHoras: armazenamento.autonomiaHoras,
      ...dimensionamentoBateria.dados,
      ...orcamento.dados,
      energiaMensalFvKwh: energia.valor,
      custoBateriaBrl: dimensionamentoBateria.dados.custoBateriaBrl,
      logs: {
        create: [montarLogEnergiaFv(consumo.consumoKwhMes, percentual.valor, energia.valor), ...dimensionamentoBateria.logs, ...(orcamento.log ? [orcamento.log] : [])]
      }
    }
  });

  res.status(201).json(adicionarResultadosDeGeracao(cenario));
}

async function buscarCenarioDoUsuario(imovelId, cenarioId, usuarioId) {
  return prisma.cenarioDimensionamento.findFirst({
    where: {
      id: Number(cenarioId),
      imovelId: Number(imovelId),
      imovel: { usuarioId }
    }
  });
}

// GET /imoveis/:id/cenarios/:cenarioId
async function obter(req, res) {
  const cenario = await buscarCenarioDoUsuario(req.params.id, req.params.cenarioId, req.usuarioId);
  if (!cenario) {
    return res.status(404).json({ message: 'cenário não encontrado' });
  }
  res.json(adicionarResultadosDeGeracao(cenario));
}

// PUT /imoveis/:id/cenarios/:cenarioId — ajusta parâmetros e recalcula HSP/E_FV
async function atualizar(req, res) {
  const existente = await buscarCenarioDoUsuario(req.params.id, req.params.cenarioId, req.usuarioId);
  if (!existente) {
    return res.status(404).json({ message: 'cenário não encontrado' });
  }

  const { consumoReferenciaKwh, percentualAtendimento, cidade, uf, hspKwhM2Dia, usarHspTabela } = req.body;

  let consumoKwhMes = existente.consumoReferenciaKwh;
  let consumoOrigem = existente.consumoOrigem;
  if (!vazio(consumoReferenciaKwh)) {
    const consumo = resolverConsumoReferencia({ consumoManual: consumoReferenciaKwh, sugestao: null });
    if (consumo.erro) {
      return res.status(400).json({ message: consumo.erro });
    }
    consumoKwhMes = consumo.consumoKwhMes;
    consumoOrigem = consumo.origem;
  }

  let percentualFinal = existente.percentualAtendimento;
  if (percentualAtendimento !== undefined) {
    const percentual = validarPercentual(percentualAtendimento);
    if (percentual.erro) {
      return res.status(400).json({ message: percentual.erro });
    }
    percentualFinal = percentual.valor;
  }

  let localidade = { cidade: existente.cidade, uf: existente.uf };
  if (cidade !== undefined || uf !== undefined) {
    localidade = validarLocalidade({ cidade: cidade ?? existente.cidade, uf: uf ?? existente.uf });
    if (localidade.erro) {
      return res.status(400).json({ message: localidade.erro });
    }
  }

  // HSP: manual informado > volta p/ tabela (pedido explícito, UF mudou, ou ainda não tinha) > mantém
  let hspDados = {
    hsp: existente.hspKwhM2Dia,
    origem: existente.hspOrigem,
    fonte: existente.hspFonte
  };
  const ufMudou = localidade.uf !== existente.uf;
  if (!vazio(hspKwhM2Dia)) {
    const hsp = resolverHsp({ uf: localidade.uf, hspManual: hspKwhM2Dia });
    if (hsp.erro) return res.status(400).json({ message: hsp.erro });
    hspDados = hsp;
  } else if (usarHspTabela === true || existente.hspKwhM2Dia === null || (ufMudou && existente.hspOrigem !== 'manual')) {
    const hsp = resolverHsp({ uf: localidade.uf });
    if (hsp.erro) return res.status(400).json({ message: hsp.erro });
    hspDados = hsp;
  }

  const armazenamento = resolverArmazenamento({
    armazenamento: req.body.armazenamento ?? existente.armazenamento,
    autonomiaHoras: req.body.autonomiaHoras ?? existente.autonomiaHoras
  });
  if (armazenamento.erro) {
    return res.status(400).json({ message: armazenamento.erro });
  }

  const bateriaId = req.body.bateriaId ?? existente.bateriaId;
  const dimensionamentoBateria = resolverDimensionamentoBateria({
    consumoKwhMes,
    armazenamento: armazenamento.armazenamento,
    autonomiaHoras: armazenamento.autonomiaHoras,
    bateriaId,
    permitirSemSelecao: armazenamento.armazenamento && existente.bateriaId == null && req.body.bateriaId === undefined
  });
  if (dimensionamentoBateria.erro) {
    return res.status(400).json({ message: dimensionamentoBateria.erro });
  }

  const energia = calcularEnergiaFv(consumoKwhMes, percentualFinal);
  if (energia.erro) {
    return res.status(400).json({ message: energia.erro });
  }
  const orcamento = resolverOrcamento(req.body, energia.valor, hspDados.hsp, armazenamento.armazenamento, bateriaId, {
    ...existente,
    custoBateriaBrl: dimensionamentoBateria.dados.custoBateriaBrl
  });
  if (orcamento.erro) return res.status(400).json({ message: orcamento.erro, alternativas: orcamento.alternativas || [] });

  const cenario = await prisma.cenarioDimensionamento.update({
    where: { id: existente.id },
    data: {
      cidade: localidade.cidade,
      uf: localidade.uf,
      consumoReferenciaKwh: consumoKwhMes,
      consumoOrigem,
      percentualAtendimento: percentualFinal,
      hspKwhM2Dia: hspDados.hsp,
      hspOrigem: hspDados.origem,
      hspFonte: hspDados.fonte,
      armazenamento: armazenamento.armazenamento,
      autonomiaHoras: armazenamento.autonomiaHoras,
      ...dimensionamentoBateria.dados,
      ...orcamento.dados,
      energiaMensalFvKwh: energia.valor,
      custoBateriaBrl: dimensionamentoBateria.dados.custoBateriaBrl,
      logs: { create: [montarLogEnergiaFv(consumoKwhMes, percentualFinal, energia.valor), ...dimensionamentoBateria.logs, ...(orcamento.log ? [orcamento.log] : [])] }
    }
  });

  res.json(adicionarResultadosDeGeracao(cenario));
}

// GET /imoveis/:id/cenarios/:cenarioId/logs — evidências de cálculo
async function logs(req, res) {
  const cenario = await buscarCenarioDoUsuario(req.params.id, req.params.cenarioId, req.usuarioId);
  if (!cenario) {
    return res.status(404).json({ message: 'cenário não encontrado' });
  }
  const registros = await prisma.cenarioCalculoLog.findMany({
    where: { cenarioId: cenario.id },
    orderBy: { createdAt: 'desc' }
  });
  res.json(registros);
}

async function listarCenarios(req, res) {
  const imovel = await buscarImovelDoUsuario(req.params.id, req.usuarioId);
  if (!imovel) return res.status(404).json({ message: 'imóvel não encontrado' });
  const cenarios = await prisma.cenarioDimensionamento.findMany({ where: { imovelId: imovel.id }, orderBy: { createdAt: 'desc' } });
  res.json(cenarios.map(adicionarResultadosDeGeracao));
}

module.exports = { referencia, consultarHsp, consultarBaterias, consultarPaineis, consultarInversores, consultarInversoresCompativeis, criar, listarCenarios, obter, atualizar, logs };
