# database

Hides the SQLite file: opening it with WAL and foreign keys, creating the tables, and applying
additive column migrations before indexes are built. Other modules get a connection and write
their own SQL against their own tables; the schema text lives here so there is one place to
read the shape of the data.
