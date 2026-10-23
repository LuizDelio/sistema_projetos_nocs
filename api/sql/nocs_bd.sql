CREATE TABLE pessoa (
  id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome  VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE usuario (
  pessoa_id   INT UNSIGNED PRIMARY KEY,
  email       VARCHAR(160) NOT NULL UNIQUE,
  senha_hash  VARCHAR(255) NOT NULL,
  perfil      ENUM('admin','editor') NOT NULL DEFAULT 'editor',
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_usuario_pessoa FOREIGN KEY (pessoa_id) REFERENCES pessoa(id) ON DELETE CASCADE
);

CREATE TABLE edital (
  id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero  VARCHAR(10)  NOT NULL,                       
  orgao   ENUM('PROPI','PROEX','PROEN','DG/PAR') NOT NULL,
  titulo  VARCHAR(300) NULL,
  UNIQUE KEY uq_edital (numero, orgao)
);

CREATE TABLE projeto (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome           VARCHAR(400) NOT NULL,
  tipo           ENUM('Pesquisa','Extensão','Ensino') NOT NULL,
  fluxo_continuo BOOLEAN NOT NULL DEFAULT FALSE,       
  identificador  VARCHAR(20) NULL UNIQUE,              
  coordenador_id INT UNSIGNED NULL,
  edital_id      INT UNSIGNED NULL,
  inicio         DATE NULL,
  termino        DATE NULL,
  financiado     BOOLEAN NOT NULL DEFAULT FALSE,
  valor          DECIMAL(10,2) NULL,                   
  CONSTRAINT fk_proj_coord  FOREIGN KEY (coordenador_id) REFERENCES pessoa(id),
  CONSTRAINT fk_proj_edital FOREIGN KEY (edital_id)      REFERENCES edital(id),
  CONSTRAINT ck_datas  CHECK (termino IS NULL OR inicio IS NULL OR termino >= inicio),
  CONSTRAINT ck_valor  CHECK (valor IS NULL OR financiado)
);


CREATE VIEW projeto_status AS
SELECT p.*,
  CASE
    WHEN inicio IS NULL OR termino IS NULL THEN 'sem datas'
    WHEN CURDATE() < inicio  THEN 'programado'
    WHEN CURDATE() > termino THEN 'concluído'
    ELSE 'em andamento'
  END AS status
FROM projeto p;
