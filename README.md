# Luminatec · Tomador de Pedidos — despliegue en Vercel

App para que los vendedores carguen pedidos. Funciona **offline** (PWA), **manda el pedido por mail**
y lo **carga en Odoo como presupuesto borrador** para aprobación. Login por vendedor con contraseña.

## Cómo está armado

- **Frente (PWA):** `index.html` + `app-integration.js` + `sw.js` + `manifest.webmanifest` + iconos.
  Es la app que ya veníamos usando, ahora con login real, modo offline y cola de "pendientes".
- **Backend (funciones serverless, carpeta `api/`):**
  - `api/login.js` — valida la contraseña del vendedor y devuelve un token de sesión.
  - `api/order.js` — crea el pedido en Odoo (borrador) y manda el mail.
  - `api/_lib.js` — utilidades (token firmado + cliente Odoo).

Nada sensible va en el código: Odoo, el mail y las contraseñas se cargan como **variables de entorno** en Vercel.

---

## Pasos para publicarla (una sola vez)

### 1) Usuario de API en Odoo
1. En Odoo, creá (o elegí) un usuario dedicado, por ejemplo `pedidos-api@luminatec.com`, con permiso de **Ventas** y acceso a la empresa **LUMINATEC S.R.L. (co6)**.
2. Con ese usuario: **Preferencias → Seguridad de la cuenta → Nueva clave de API**. Guardá la clave (no se vuelve a mostrar).
   - `ODOO_URL` = `https://gpowerbyte-luminatec.odoo.com`
   - `ODOO_DB` = `gpowerbyte-luminatec`
   - `ODOO_USER` = el login de ese usuario
   - `ODOO_API_KEY` = la clave que generaste

### 2) Mail (Resend — gratis)
1. Creá una cuenta en https://resend.com y verificá tu dominio (`luminatec.com`) o usá el remitente de prueba que te dan.
2. Generá una **API Key**.
   - `RESEND_API_KEY` = la key
   - `MAIL_FROM` = un remitente de tu dominio verificado (ej. `pedidos@luminatec.com`)
   - `MAIL_TO` = a quién le llegan los pedidos, separado por comas (ej. `ventas@luminatec.com,nacho@luminatec.com`)

### 3) Publicar en Vercel
1. Creá una cuenta en https://vercel.com (plan gratis).
2. Subí esta carpeta: podés arrastrar el proyecto en **Add New → Project** (o conectarlo a un repo de GitHub).
   No hace falta configurar framework: Vercel detecta la carpeta `api/` como funciones y sirve el resto como estático.
3. En **Settings → Environment Variables** cargá todas las variables (ver `.env.example`):
   `ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY, ODOO_COMPANY_ID=6, APP_SECRET, VENDOR_PASSWORDS` (o `TEAM_PASSWORD`),
   `RESEND_API_KEY, MAIL_FROM, MAIL_TO`.
   - `APP_SECRET`: inventá una frase larga y secreta (firma los tokens de sesión).
4. **Deploy**. Vercel te da una URL (ej. `https://pedidos-luminatec.vercel.app`).

### Contraseñas de vendedores (`VENDOR_PASSWORDS`)
Es un JSON donde la **clave es el id del vendedor** (campo "Referido" en Odoo) y el valor su contraseña.
Los ids de la cartera actual (co6):

| Vendedor | id |
|---|---|
| GERENCIA COMERCIAL | 152238 |
| PEREZ KOHUT HORACIO GUSTAVO | 152432 |
| LUCAS RIVERO JAVIER | 49121 |
| MARTIN JAGODNIK | 49142 |
| EDUARDO MIGUEL MORENO | 49338 |
| FLOMAT REPRESENTACIONES SRL | 120501 |
| RUBEN ENRIQUE CARRIZO | 49339 |
| MAGENTA PABLO MATIAS | 152394 |
| SOFIA JOSE MARIA | 49340 |
| Adrian Hugo Giosa | 156600 |
| Maximiliano Alejandro Figueroa | 155658 |
| GARCIA EDUARDO DANIEL | 49014 |
| Antonio Iglesias | 150857 |
| Mariano Toman | 152243 |

Ejemplo:
```
VENDOR_PASSWORDS={"120501":"flomat2026","49121":"lucas2026"}
```
Si preferís empezar con **una sola clave para todos**, no cargues `VENDOR_PASSWORDS` y usá `TEAM_PASSWORD=...`.

---

## Primera prueba (juntos)
1. Entrá a la URL, elegí un vendedor y poné su contraseña.
2. Cargá un cliente y 1–2 productos, y tocá **Enviar pedido**.
3. Verificá que: (a) llega el mail, (b) aparece el pedido como **presupuesto en borrador** en Odoo (Ventas → Presupuestos).
4. Prueba offline: activá modo avión, cargá un pedido (queda en "pendientes"), reconectá y tocá el botón **"⟳ pendientes · Enviar"**.

> Nota: la app crea el pedido en Odoo en estado **borrador** (no confirmado), para que lo aprueben desde Odoo.

## Mantenimiento / cambios
- Para actualizar el catálogo o los precios no hace falta tocar el backend: se regenera el `index.html`.
- Si rota la API Key de Odoo o cambia el mail, se actualiza la variable de entorno en Vercel y listo.
- Los datos de productos/clientes están embebidos en `index.html` (snapshot). Para refrescarlos hay que regenerar ese archivo.
