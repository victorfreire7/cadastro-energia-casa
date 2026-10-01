const prisma = require('../prisma/client');
const { vazio, validarLocalidade } = require('../services/dimensionamento');

function validarEletrodomesticos(lista) {
  for (const e of lista) {
    if (!e.nome) {
      return 'cada eletrodoméstico precisa de um nome';
    }
    if (typeof e.potenciaW !== 'number' || e.potenciaW <= 0) {
      return `potenciaW de "${e.nome}" deve ser um número maior que zero`;
    }
    if (!Number.isInteger(e.quantidade) || e.quantidade <= 0) {
      return `quantidade de "${e.nome}" deve ser um número inteiro maior que zero`;
    }
    if (typeof e.horasDia !== 'number' || e.horasDia <= 0 || e.horasDia > 24) {
      return `horasDia de "${e.nome}" deve estar entre 0 e 24`;
    }
  }
  return null;
}

async function criar(req, res) {
  const { endereco, tipo, eletrodomesticos, cidade, uf } = req.body;

  if (!endereco || !tipo) {
    return res.status(400).json({ message: 'endereco e tipo são obrigatórios' });
  }

  // Localidade é opcional no cadastro, mas se vier deve ser válida (usada no dimensionamento FV)
  let localidade = {};
  if (!vazio(cidade) || !vazio(uf)) {
    localidade = validarLocalidade({ cidade, uf });
    if (localidade.erro) {
      return res.status(400).json({ message: localidade.erro });
    }
  }

  const lista = eletrodomesticos || [];
  const erro = validarEletrodomesticos(lista);
  if (erro) {
    return res.status(400).json({ message: erro });
  }

  const imovel = await prisma.imovel.create({
    data: {
      endereco,
      tipo,
      ...(localidade.cidade && { cidade: localidade.cidade, uf: localidade.uf }),
      usuarioId: req.usuarioId,
      eletrodomesticos: {
        create: lista.map(e => ({
          nome: e.nome,
          potenciaW: e.potenciaW,
          quantidade: e.quantidade,
          horasDia: e.horasDia
        }))
      }
    },
    include: { eletrodomesticos: true }
  });

  res.status(201).json(imovel);
}

async function listar(req, res) {
  const imoveis = await prisma.imovel.findMany({
    where: { usuarioId: req.usuarioId },
    include: { eletrodomesticos: true }
  });

  res.json(imoveis);
}

async function buscarDoUsuario(id, usuarioId) {
  return prisma.imovel.findFirst({ where: { id: Number(id), usuarioId } });
}

async function atualizar(req, res) {
  const { id } = req.params;
  const existente = await buscarDoUsuario(id, req.usuarioId);

  if (!existente) {
    return res.status(404).json({ message: 'imóvel não encontrado' });
  }

  const { endereco, tipo, status, cidade, uf } = req.body;

  let localidade = {};
  if (!vazio(cidade) || !vazio(uf)) {
    localidade = validarLocalidade({
      cidade: cidade ?? existente.cidade,
      uf: uf ?? existente.uf
    });
    if (localidade.erro) {
      return res.status(400).json({ message: localidade.erro });
    }
  }

  const imovel = await prisma.imovel.update({
    where: { id: Number(id) },
    data: {
      ...(endereco && { endereco }),
      ...(tipo && { tipo }),
      ...(status && { status }),
      ...(localidade.cidade && { cidade: localidade.cidade, uf: localidade.uf })
    }
  });

  res.json(imovel);
}

async function excluir(req, res) {
  const { id } = req.params;
  const existente = await buscarDoUsuario(id, req.usuarioId);

  if (!existente) {
    return res.status(404).json({ message: 'imóvel não encontrado' });
  }

  // FKs são RESTRICT: remove os dependentes antes do imóvel
  await prisma.$transaction([
    prisma.cenarioCalculoLog.deleteMany({ where: { cenario: { imovelId: Number(id) } } }),
    prisma.cenarioDimensionamento.deleteMany({ where: { imovelId: Number(id) } }),
    prisma.consumoHistorico.deleteMany({ where: { imovelId: Number(id) } }),
    prisma.eletrodomestico.deleteMany({ where: { imovelId: Number(id) } }),
    prisma.imovel.delete({ where: { id: Number(id) } })
  ]);

  res.status(204).send();
}

module.exports = { criar, listar, atualizar, excluir };
