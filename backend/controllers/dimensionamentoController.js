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

  const energia = calcularEnergiaFv(consumo.consumoKwhMes, percentual.valor);
  if (energia.erro) {
    return res.status(400).json({ message: energia.erro });
  }

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
      energiaMensalFvKwh: energia.valor,
      logs: {
        create: [montarLogEnergiaFv(consumo.consumoKwhMes, percentual.valor, energia.valor)]
      }
    }
  });

  res.status(201).json(cenario);
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
  res.json(cenario);
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

  const energia = calcularEnergiaFv(consumoKwhMes, percentualFinal);
  if (energia.erro) {
    return res.status(400).json({ message: energia.erro });
  }

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
      energiaMensalFvKwh: energia.valor,
      logs: { create: [montarLogEnergiaFv(consumoKwhMes, percentualFinal, energia.valor)] }
    }
  });

  res.json(cenario);
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

module.exports = { referencia, consultarHsp, criar, obter, atualizar, logs };
