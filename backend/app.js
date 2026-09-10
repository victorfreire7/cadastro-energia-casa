require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./prisma/client');
const authRoutes = require('./routes/auth');
const imovelRoutes = require('./routes/imovel');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', message: err.message });
  }
});

app.use('/auth', authRoutes);
app.use('/imoveis', imovelRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
