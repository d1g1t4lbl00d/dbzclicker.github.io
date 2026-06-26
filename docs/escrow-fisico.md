# Plan técnico — Ventas físicas con escrow (para retomar)

Estado actual: **las ventas físicas están desactivadas** y **toda la tienda está oculta**
(`SHOP_ENABLED = false` en `js/app.js`). Lo digital (beats, packs, servicios, entradas)
está completo y es seguro. Este documento describe cómo reactivar lo físico **con
protección real** (escrow) cuando se quiera.

## Por qué hace falta escrow

Hoy el cobro usa **destination charges** (`transfer_data.destination` en
`api/pay/_checkout.js`): el dinero se transfiere al vendedor **en el momento del pago**.
Para físico eso es peligroso:

- No hay prueba de entrega → el comprador puede abrir disputa ("no llegó").
- **La plataforma (tú) asume los reembolsos y chargebacks** (config de Connect elegida).
- Si reembolsas, el dinero ya está con el vendedor → la pérdida la asumes tú.

Escrow = **retener** el pago del vendedor hasta confirmar la entrega (o que pase un plazo).

## Modelo de pago a usar: "Separate Charges & Transfers"

En vez de `transfer_data.destination` (transferencia automática), separar en dos pasos:

1. **Cobro (charge):** crear la sesión de Checkout **sin** `transfer_data`, de modo que
   los fondos queden en el **saldo de la plataforma** (no van al vendedor todavía).
   Guardar `application_fee` aparte (tu comisión) o calcularla al transferir.
2. **Transferencia diferida (transfer):** cuando el pedido se marca **entregado**
   (comprador confirma o pasan N días sin disputa), crear un `POST /v1/transfers`
   con `destination = stripe_account_id` del vendedor por el importe (precio + envío − comisión).
   - Si **no** se entrega / se reporta no recibido → **reembolso** al comprador
     (`POST /v1/refunds`) sin haber transferido nada → no pierdes dinero.

Docs Stripe: "Separate charges and transfers".

## Cambios de base de datos (SQL)

```sql
-- estado del flujo físico en el pedido
alter table public.shop_orders add column if not exists fulfillment text default 'pending';
  -- pending | shipped | delivered | disputed | refunded | released(=transferido)
alter table public.shop_orders add column if not exists tracking_carrier text;
alter table public.shop_orders add column if not exists tracking_number text;
alter table public.shop_orders add column if not exists delivered_at timestamptz;
alter table public.shop_orders add column if not exists auto_release_at timestamptz; -- fecha límite para liberar fondos
alter table public.shop_orders add column if not exists stripe_transfer_id text;
alter table public.shop_orders add column if not exists dispute_reason text;

-- RPCs seguras (security definer):
--   shop_set_tracking(o_id, carrier, number)   -> solo el vendedor; marca 'shipped' + auto_release_at = now()+Ndias
--   shop_confirm_received(o_id)                -> solo el comprador; marca 'delivered' (dispara transfer)
--   shop_open_dispute(o_id, reason)            -> solo el comprador; marca 'disputed'
```

## Cambios de backend (`api/pay/`)

- `_checkout.js`: si el producto es físico → **NO** poner `transfer_data.destination`.
  Cobrar en la plataforma. Recoger dirección de envío (ya implementado).
- Nuevo endpoint o cron de **liberación**: al confirmar entrega o al llegar
  `auto_release_at` sin disputa → `POST /v1/transfers` al vendedor y marcar `released`.
  (Cron: Vercel Cron diario que busca pedidos `shipped` con `auto_release_at < now()` y los libera.)
- `_webhook.js`: en `charge.dispute.created` → congelar (no liberar) y avisar al admin.
- Nuevo: endpoint para que el vendedor/admin haga **reembolso** desde la app.

## Cambios de frontend (`js/app.js`)

- Reactivar `SHOP_ENABLED = true` y volver a mostrar la opción **Físico** en el editor
  (quitar el `display:none` de `#shKindWrap`, restaurar `kind = shopKindOf(p)`).
- **Comprador (Mis compras):** botón **"Confirmar recibido"** y **"Reportar problema"**;
  mostrar nº de seguimiento y estado (pendiente/enviado/entregado).
- **Vendedor (Mis ventas):** campo **nº de seguimiento + transportista** (en vez del simple
  "marcar enviado"); ver estado de liberación de fondos.
- **Disputas:** pantalla simple donde el admin media (ver caso, reembolsar o liberar).
- Avisar de los **plazos**: "el dinero se libera al vendedor cuando confirmas la recepción
  o a los N días del envío".

## Parámetros recomendados

- **N días de auto-liberación:** 7–14 días desde el envío (configurable por env, p. ej. `ESCROW_DAYS`).
- **Ventana de disputa:** hasta la auto-liberación.
- **Países de envío:** ya configurados en `_checkout.js` (`shipping_address_collection`).

## Resumen de la garantía que aporta

- El vendedor **no cobra hasta** que el comprador confirma o pasa el plazo.
- Si no llega → **reembolso** al comprador sin pérdida para la plataforma.
- Seguimiento + confirmación + disputa = trazabilidad y mediación.

Con esto, lo físico pasa de "a confianza" a **protegido de extremo a extremo**.
