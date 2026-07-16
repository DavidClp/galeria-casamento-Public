import multer from 'multer'

// Sem fileSize aqui: um arquivo grande não pode abortar o lote inteiro.
// A validação de tamanho (com aviso parcial) fica no service.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 20 },
})
