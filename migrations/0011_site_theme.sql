CREATE TABLE site_theme (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    primary_color TEXT NOT NULL,
    secondary_color TEXT NOT NULL,
    background_color TEXT NOT NULL
);
