const prisma = require('../prisma/client');

async function criar(req, res) {
  const { endereco, tipo, eletrodomesticos } = req.body;

  if (!endereco || !tipo) {
    return res.status(400).json({ message: 'endereco e tipo são obrigatórios' });
  }

  const imovel = await prisma.imovel.create({
    data: {
      endereco,
      tipo,
      usuarioId: req.usuarioId,
      eletrodomesticos: {
        create: (eletrodomesticos || []).map(e => ({
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

  const { endereco, tipo, status } = req.body;

  const imovel = await prisma.imovel.update({
    where: { id: Number(id) },
    data: {
      ...(endereco && { endereco }),
      ...(tipo && { tipo }),
      ...(status && { status })
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

  await prisma.eletrodomestico.deleteMany({ where: { imovelId: Number(id) } });
  await prisma.imovel.delete({ where: { id: Number(id) } });

  res.status(204).send();
}

module.exports = { criar, listar, atualizar, excluir };
