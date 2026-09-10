const prisma = require('../prisma/client');

function calcularConsumoEletrodomestico(e) {
  return (e.potenciaW * e.quantidade * e.horasDia * 30) / 1000;
}

async function buscarImovelDoUsuario(id, usuarioId) {
  return prisma.imovel.findFirst({
    where: { id: Number(id), usuarioId },
    include: { eletrodomesticos: true }
  });
}

async function calcular(req, res) {
  const { id } = req.params;
  const imovel = await buscarImovelDoUsuario(id, req.usuarioId);

  if (!imovel) {
    return res.status(404).json({ message: 'imóvel não encontrado' });
  }

  const porEletrodomestico = imovel.eletrodomesticos.map(e => ({
    id: e.id,
    nome: e.nome,
    consumoKwhMes: Number(calcularConsumoEletrodomestico(e).toFixed(2))
  }));

  const total = porEletrodomestico.reduce((soma, e) => soma + e.consumoKwhMes, 0);

  res.json({
    imovelId: imovel.id,
    porEletrodomestico,
    totalKwhMes: Number(total.toFixed(2))
  });
}

async function registrar(req, res) {
  const { id } = req.params;
  const imovel = await buscarImovelDoUsuario(id, req.usuarioId);

  if (!imovel) {
    return res.status(404).json({ message: 'imóvel não encontrado' });
  }

  const total = imovel.eletrodomesticos.reduce(
    (soma, e) => soma + calcularConsumoEletrodomestico(e),
    0
  );

  const mesReferencia = req.body.mesReferencia || new Date().toISOString().slice(0, 7);

  const registro = await prisma.consumoHistorico.create({
    data: {
      imovelId: imovel.id,
      mesReferencia,
      consumoTotalKwh: Number(total.toFixed(2))
    }
  });

  res.status(201).json(registro);
}

async function historico(req, res) {
  const { id } = req.params;
  const imovel = await buscarImovelDoUsuario(id, req.usuarioId);

  if (!imovel) {
    return res.status(404).json({ message: 'imóvel não encontrado' });
  }

  const registros = await prisma.consumoHistorico.findMany({
    where: { imovelId: Number(id) },
    orderBy: { mesReferencia: 'asc' }
  });

  const comComparativo = registros.map((registro, index) => {
    if (index === 0) {
      return { ...registro, variacaoKwh: null };
    }
    const anterior = registros[index - 1];
    const variacao = Number((registro.consumoTotalKwh - anterior.consumoTotalKwh).toFixed(2));
    return { ...registro, variacaoKwh: variacao };
  });

  res.json(comComparativo);
}

module.exports = { calcular, registrar, historico };
