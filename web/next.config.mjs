/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cada carga de ticker ya dispara ~40+ llamadas a Massive (paginación de la
  // cadena de opciones). El doble-montaje de Strict Mode en dev duplica esa
  // ráfaga y por sí solo agota el límite por segundo del plan. Se desactiva
  // aquí porque el costo (perder la detección de efectos no-idempotentes) es
  // menor que el de tropezar con rate limits en cada carga.
  reactStrictMode: false,
};

export default nextConfig;
