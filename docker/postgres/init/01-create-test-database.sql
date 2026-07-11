SELECT 'CREATE DATABASE dance_academy_test'
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'dance_academy_test'
)\gexec
