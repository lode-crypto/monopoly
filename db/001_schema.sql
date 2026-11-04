BEGIN;
CREATE TABLE usuarios (
 id UUID PRIMARY KEY, nombre VARCHAR(120) NOT NULL, correo VARCHAR(150) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, rol VARCHAR(20) NOT NULL CHECK (rol IN ('administrador','docente','estudiante')),
 activo BOOLEAN NOT NULL DEFAULT true, creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (correo=lower(correo))
);
CREATE TABLE tableros (
 id UUID PRIMARY KEY, nombre VARCHAR(100) NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 descripcion TEXT NOT NULL, UNIQUE(nombre,version)
);
CREATE TABLE casillas (
 id UUID PRIMARY KEY, tablero_id UUID NOT NULL REFERENCES tableros(id), posicion INTEGER NOT NULL CHECK(posicion>=0),
 nombre VARCHAR(100) NOT NULL, tipo VARCHAR(25) NOT NULL CHECK(tipo IN ('salida','activo','impuesto','evento')),
 valores_base JSONB NOT NULL, UNIQUE(tablero_id,posicion), UNIQUE(id,tablero_id)
);
CREATE TABLE partidas (
 id UUID PRIMARY KEY, docente_id UUID NOT NULL REFERENCES usuarios(id), tablero_id UUID NOT NULL REFERENCES tableros(id),
 nombre VARCHAR(120) NOT NULL, codigo VARCHAR(16) NOT NULL UNIQUE,
 estado VARCHAR(20) NOT NULL CHECK(estado IN ('espera','activa','pausada','finalizada','cancelada')),
 configuracion JSONB NOT NULL, version_estado BIGINT NOT NULL DEFAULT 0 CHECK(version_estado>=0),
 iniciada_en TIMESTAMPTZ, finalizada_en TIMESTAMPTZ, creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
 tiempo_activo_ms BIGINT NOT NULL DEFAULT 0 CHECK(tiempo_activo_ms>=0), motivo_cierre TEXT,
 -- Inicio del tramo activo, permite pausar el reloj y recuperarlo tras reinicios.
 tramo_activo_en TIMESTAMPTZ
);
CREATE TABLE participantes (
 id UUID PRIMARY KEY, partida_id UUID NOT NULL REFERENCES partidas(id), usuario_id UUID NOT NULL REFERENCES usuarios(id),
 orden_turno INTEGER NOT NULL CHECK(orden_turno>=0), posicion INTEGER NOT NULL DEFAULT 0 CHECK(posicion>=0),
 saldo NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(saldo>=0),
 estado VARCHAR(20) NOT NULL CHECK(estado IN ('espera','activo','insolvente')),
 ultima_conexion TIMESTAMPTZ, obligacion_pendiente NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(obligacion_pendiente>=0),
 UNIQUE(partida_id,usuario_id), UNIQUE(partida_id,orden_turno), UNIQUE(id,partida_id)
);
CREATE TABLE activos_partida (
 id UUID PRIMARY KEY, partida_id UUID NOT NULL REFERENCES partidas(id), casilla_id UUID NOT NULL REFERENCES casillas(id),
 propietario_id UUID, precio_base NUMERIC(14,2) NOT NULL CHECK(precio_base>=0),
 nivel_inversion INTEGER NOT NULL DEFAULT 0 CHECK(nivel_inversion>=0),
 valor_rescate NUMERIC(14,2) NOT NULL CHECK(valor_rescate>=0), UNIQUE(partida_id,casilla_id), UNIQUE(id,partida_id),
 FOREIGN KEY(propietario_id,partida_id) REFERENCES participantes(id,partida_id)
);
CREATE TABLE turnos (
 id UUID PRIMARY KEY, partida_id UUID NOT NULL REFERENCES partidas(id), participante_id UUID NOT NULL,
 numero INTEGER NOT NULL CHECK(numero>0), estado VARCHAR(25) NOT NULL CHECK(estado IN ('pendiente','movimiento','decision','venta_banco','cerrado')),
 dados JSONB, abierto_en TIMESTAMPTZ, cerrado_en TIMESTAMPTZ,
 UNIQUE(partida_id,numero), UNIQUE(id,partida_id),
 FOREIGN KEY(participante_id,partida_id) REFERENCES participantes(id,partida_id)
);
CREATE UNIQUE INDEX un_turno_abierto ON turnos(partida_id) WHERE estado<>'cerrado';
CREATE TABLE acciones (
 id UUID PRIMARY KEY, partida_id UUID NOT NULL REFERENCES partidas(id), turno_id UUID, usuario_id UUID NOT NULL REFERENCES usuarios(id),
 clave_accion UUID NOT NULL, tipo VARCHAR(40) NOT NULL, parametros_hash TEXT NOT NULL,
 version_resultado BIGINT NOT NULL, resultado JSONB NOT NULL, creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(partida_id,usuario_id,clave_accion), UNIQUE(id,partida_id),
 FOREIGN KEY(turno_id,partida_id) REFERENCES turnos(id,partida_id)
);
CREATE TABLE obligaciones (
 id UUID PRIMARY KEY, partida_id UUID NOT NULL REFERENCES partidas(id), turno_id UUID NOT NULL, deudor_id UUID NOT NULL, acreedor_id UUID,
 importe_original NUMERIC(14,2) NOT NULL CHECK(importe_original>0),
 importe_pagado NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(importe_pagado>=0 AND importe_pagado<=importe_original),
 estado VARCHAR(25) NOT NULL CHECK(estado IN ('pendiente','pagada','incobrable')),
 creada_en TIMESTAMPTZ NOT NULL DEFAULT now(), cerrada_en TIMESTAMPTZ,
 tipo VARCHAR(30) NOT NULL, activo_id UUID,
 UNIQUE(id,partida_id), CHECK(acreedor_id IS NULL OR acreedor_id<>deudor_id),
 FOREIGN KEY(turno_id,partida_id) REFERENCES turnos(id,partida_id),
 FOREIGN KEY(deudor_id,partida_id) REFERENCES participantes(id,partida_id),
 FOREIGN KEY(acreedor_id,partida_id) REFERENCES participantes(id,partida_id),
 FOREIGN KEY(activo_id,partida_id) REFERENCES activos_partida(id,partida_id)
);
CREATE UNIQUE INDEX una_deuda_pendiente ON obligaciones(deudor_id) WHERE estado='pendiente';
CREATE TABLE movimientos (
 id UUID PRIMARY KEY, partida_id UUID NOT NULL REFERENCES partidas(id), accion_id UUID NOT NULL,
 origen_id UUID, destino_id UUID, activo_id UUID, obligacion_id UUID,
 tipo VARCHAR(30) NOT NULL, importe NUMERIC(14,2) NOT NULL CHECK(importe>0),
 creado_en TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,partida_id),
 CHECK(origen_id IS DISTINCT FROM destino_id),
 FOREIGN KEY(accion_id,partida_id) REFERENCES acciones(id,partida_id),
 FOREIGN KEY(origen_id,partida_id) REFERENCES participantes(id,partida_id),
 FOREIGN KEY(destino_id,partida_id) REFERENCES participantes(id,partida_id),
 FOREIGN KEY(activo_id,partida_id) REFERENCES activos_partida(id,partida_id),
 FOREIGN KEY(obligacion_id,partida_id) REFERENCES obligaciones(id,partida_id)
);
CREATE TABLE ofertas (
 id UUID PRIMARY KEY, partida_id UUID NOT NULL REFERENCES partidas(id), vendedor_id UUID NOT NULL, comprador_id UUID NOT NULL,
 activo_id UUID NOT NULL, precio NUMERIC(14,2) NOT NULL CHECK(precio>0),
 estado VARCHAR(20) NOT NULL CHECK(estado IN ('pendiente','aceptada','rechazada','caducada')),
 turno_limite INTEGER NOT NULL, creada_en TIMESTAMPTZ NOT NULL DEFAULT now(), turno_id UUID NOT NULL,
 UNIQUE(id,partida_id), CHECK(vendedor_id<>comprador_id),
 FOREIGN KEY(vendedor_id,partida_id) REFERENCES participantes(id,partida_id),
 FOREIGN KEY(comprador_id,partida_id) REFERENCES participantes(id,partida_id),
 FOREIGN KEY(activo_id,partida_id) REFERENCES activos_partida(id,partida_id),
 FOREIGN KEY(turno_id,partida_id) REFERENCES turnos(id,partida_id)
);
CREATE UNIQUE INDEX una_oferta_activo ON ofertas(activo_id) WHERE estado='pendiente';
CREATE TABLE auditoria (
 id UUID PRIMARY KEY, usuario_id UUID NOT NULL REFERENCES usuarios(id), partida_id UUID REFERENCES partidas(id),
 evento VARCHAR(60) NOT NULL, detalle JSONB NOT NULL, creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sesiones_acceso (
 id UUID PRIMARY KEY, usuario_id UUID NOT NULL REFERENCES usuarios(id), token_hash TEXT NOT NULL UNIQUE,
 creada_en TIMESTAMPTZ NOT NULL DEFAULT now(), expira_en TIMESTAMPTZ NOT NULL, revocada_en TIMESTAMPTZ
);
CREATE INDEX participantes_usuario ON participantes(usuario_id);
CREATE INDEX partidas_docente ON partidas(docente_id);
CREATE INDEX movimientos_historial ON movimientos(partida_id,creado_en);
CREATE INDEX acciones_historial ON acciones(partida_id,creada_en);
CREATE INDEX sesiones_usuario ON sesiones_acceso(usuario_id);
-- Defensa adicional: una propiedad siempre pertenece al tablero de su partida.
CREATE FUNCTION validar_tablero_activo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM partidas p JOIN casillas c ON c.tablero_id=p.tablero_id WHERE p.id=NEW.partida_id AND c.id=NEW.casilla_id AND c.tipo='activo') THEN
  RAISE EXCEPTION 'Casilla fuera del tablero de la partida' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER tablero_activo BEFORE INSERT OR UPDATE ON activos_partida FOR EACH ROW EXECUTE FUNCTION validar_tablero_activo();
COMMIT;
