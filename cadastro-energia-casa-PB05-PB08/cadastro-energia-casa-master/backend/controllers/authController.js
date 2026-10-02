const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function register(req, res) {
  const { nome, email, senha } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ message: 'nome, email e senha são obrigatórios' });
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: 'email inválido' });
  }

  if (senha.length < 8) {
    return res.status(400).json({ message: 'senha deve ter no mínimo 8 caracteres' });
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    return res.status(409).json({ message: 'email já cadastrado' });
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  const usuario = await prisma.usuario.create({
    data: { nome, email, senha: senhaHash }
  });

  res.status(201).json({ id: usuario.id, nome: usuario.nome, email: usuario.email });
}

async function login(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ message: 'email e senha são obrigatórios' });
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario) {
    return res.status(401).json({ message: 'credenciais inválidas' });
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senha);
  if (!senhaValida) {
    return res.status(401).json({ message: 'credenciais inválidas' });
  }

  const token = jwt.sign(
    { id: usuario.id, email: usuario.email },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  res.json({ token });
}

module.exports = { register, login };
