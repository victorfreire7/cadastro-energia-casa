const prisma = require('../prisma/client');
const { calcularConsumoEletrodomestico } = require('./consumoController');
const { calcularSugestaoReferencia, JANELA_HISTORICO_MESES } = require('../services/dimensionamento');
const { HSP_MIN, HSP_MAX, obterHspPorUf } = require('../services/hsp');
const { preDimensionar, calcularProjeto, paineisDisponiveis, bateriasDisponiveis } = require('../services/projeto');
const { validarEntradaProjeto } = require('../services/validacao');
const { renderizarHtml } = require('../services/proposta');

const PR_PADRAO = 0.75;

async function buscarImovel(id, usuarioId) {
  return prisma.imovel.findFirst({
    where: { id: Number(id), usuarioId },
    include: { eletrodomesticos: true }
  });
}

// PB01/PB02 — reaproveita o que já está cadastrado (histórico ou eletrodomésticos)
async function contexto(imovel) {
  const historico = await prisma.consumoHistorico.findMany({
    where: { imovelId: imovel.id },
    orderBy: { mesReferencia: 'desc' },
    take: JANELA_HISTORICO_MESES
  });
  const estimado = imovel.eletrodomesticos.reduce((soma, e) => soma + calcularConsumoEletrodomestico(e), 0);
  const sugestao = calcularSugestaoReferencia({ historico, consumoEstimadoKwh: estimado });
  const potenciaInstaladaKw = Number((imovel.eletrodomesticos.reduce((s, e) => s + e.potenciaW * e.quantidade, 0) / 1000).toFixed(2));
  return {
    residencia: { endereco: imovel.endereco, cidade: imovel.cidade, uf: imovel.uf, potenciaInstaladaKw },
    consumo: sugestao ? { kwhMes: sugestao.consumoKwhMes, origem: sugestao.origem } : { kwhMes: null, origem: null }
  };
}

// GET /imoveis/:id/projetos/contexto — dados que a tela preenche sozinha (sem pedir de novo)
async function obterContexto(req, res) {
  const imovel = await buscarImovel(req.params.id, req.usuarioId);
  if (!imovel) return res.status(404).json({ message: 'imóvel não encontrado' });

  const { residencia, consumo } = await contexto(imovel);
  const hsp = imovel.uf ? obterHspPorUf(imovel.uf) : null;
  res.json({
    residencia: { id: imovel.id, ...residencia },
    consumo: {
      mensalKwh: consumo.kwhMes,
      diarioKwh: consumo.kwhMes ? Number((consumo.kwhMes / 30).toFixed(2)) : null,
      origem: consumo.origem,
      potenciaInstaladaKw: residencia.potenciaInstaladaKw
    },
    hsp: hsp ? { valor: hsp.hsp, fonte: hsp.fonte, uf: hsp.uf } : null,
    faixaHsp: { min: HSP_MIN, max: HSP_MAX },
    prSugerido: PR_PADRAO,
    // datasets vêm dos CSVs; nada de equipamento ou preço fixo no código
    modulos: paineisDisponiveis(),
    baterias: bateriasDisponiveis()
  });
}

// POST /imoveis/:id/projetos/pre-dimensionamento — potência, módulos, geração e inversores compatíveis
async function predimensionar(req, res) {
  const imovel = await buscarImovel(req.params.id, req.usuarioId);
  if (!imovel) return res.status(404).json({ message: 'imóvel não encontrado' });

  const ctx = await contexto(imovel);
  // Nesta etapa ainda não existem inversor, tarifa, baterias nem custos: recebem valores neutros
  // (sobrescrevem o que a tela enviar em branco) só para reaproveitar a mesma validação.
  const validacao = validarEntradaProjeto({
    ...(req.body || {}),
    tarifaReaisKwh: 1, tarifaFonte: 'x', inversorId: 1, custoComplementarBrl: '', comBaterias: false
  });
  if (validacao.erros) return res.status(400).json({ message: validacao.erros[0], erros: validacao.erros });

  const consumoKwhMes = validacao.entrada.consumoKwhMes ?? ctx.consumo.kwhMes;
  if (!consumoKwhMes) {
    return res.status(400).json({ message: 'Esta residência ainda não tem consumo calculado. Cadastre eletrodomésticos, registre o histórico ou informe o consumo manualmente.' });
  }
  const pre = preDimensionar({
    consumoKwhMes,
    percentualAtendimento: validacao.entrada.percentualAtendimento,
    hsp: validacao.entrada.hsp,
    pr: validacao.entrada.pr,
    painelId: validacao.entrada.painelId
  });
  if (pre.erros) return res.status(400).json({ message: pre.erros[0], erros: pre.erros });

  res.json({
    consumoMensalKwh: consumoKwhMes,
    energiaFvKwhMes: pre.energiaFvKwhMes,
    potenciaNecessariaKwp: pre.dim.potenciaNecessariaKwp,
    potenciaInstaladaKwp: pre.dim.potenciaInstaladaKwp,
    quantidadeModulos: pre.dim.quantidade,
    geracao: pre.geracao,
    inversores: pre.inversores
  });
}

function responderErros(res, erros) {
  return res.status(400).json({ message: erros[0], erros });
}

// POST /imoveis/:id/projetos/calcular — calcula sem salvar
async function calcular(req, res) {
  const imovel = await buscarImovel(req.params.id, req.usuarioId);
  if (!imovel) return res.status(404).json({ message: 'imóvel não encontrado' });

  const resultado = calcularProjeto({ ...(await contexto(imovel)), corpo: req.body });
  if (resultado.erros) return responderErros(res, resultado.erros);
  res.json(resultado);
}

// POST /imoveis/:id/projetos — calcula e salva (PB20)
async function salvar(req, res) {
  const imovel = await buscarImovel(req.params.id, req.usuarioId);
  if (!imovel) return res.status(404).json({ message: 'imóvel não encontrado' });

  const resultado = calcularProjeto({ ...(await contexto(imovel)), corpo: req.body });
  if (resultado.erros) return responderErros(res, resultado.erros);

  const titulo = typeof req.body.titulo === 'string' && req.body.titulo.trim()
    ? req.body.titulo.trim().slice(0, 120)
    : `Projeto ${resultado.alternativaSelecionada === 'com' ? 'com' : 'sem'} baterias — ${new Date().toLocaleDateString('pt-BR')}`;

  const projeto = await prisma.projeto.create({
    data: {
      imovelId: imovel.id,
      titulo,
      alternativa: resultado.alternativaSelecionada,
      entrada: req.body,
      resultado,
      investimentoTotalBrl: resultado.proposta.orcamento.total,
      economiaAnualBrl: resultado.proposta.economia.economiaAnual
    }
  });
  res.status(201).json({ id: projeto.id, titulo: projeto.titulo, createdAt: projeto.createdAt, resultado });
}

// GET /imoveis/:id/projetos — lista os salvos (sem o resultado completo)
async function listar(req, res) {
  const imovel = await buscarImovel(req.params.id, req.usuarioId);
  if (!imovel) return res.status(404).json({ message: 'imóvel não encontrado' });

  const projetos = await prisma.projeto.findMany({
    where: { imovelId: imovel.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, titulo: true, alternativa: true, investimentoTotalBrl: true, economiaAnualBrl: true, createdAt: true }
  });
  res.json(projetos);
}

async function buscarProjeto(req) {
  return prisma.projeto.findFirst({
    where: { id: Number(req.params.projetoId), imovelId: Number(req.params.id), imovel: { usuarioId: req.usuarioId } }
  });
}

// GET /imoveis/:id/projetos/:projetoId — recupera tudo (entrada + resultado)
async function obter(req, res) {
  const projeto = await buscarProjeto(req);
  if (!projeto) return res.status(404).json({ message: 'projeto não encontrado' });
  res.json(projeto);
}

// GET /imoveis/:id/projetos/:projetoId/proposta?formato=html — PB21 (proposta para o cliente)
async function proposta(req, res) {
  const projeto = await buscarProjeto(req);
  if (!projeto) return res.status(404).json({ message: 'projeto não encontrado' });
  const dados = projeto.resultado.proposta;
  if (req.query.formato === 'html') {
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderizarHtml(dados));
  }
  res.json(dados);
}

async function excluir(req, res) {
  const projeto = await buscarProjeto(req);
  if (!projeto) return res.status(404).json({ message: 'projeto não encontrado' });
  await prisma.projeto.delete({ where: { id: projeto.id } });
  res.status(204).send();
}

module.exports = { obterContexto, predimensionar, calcular, salvar, listar, obter, proposta, excluir };
