const Metadata = require('./metadata');
const fetch = require('node-fetch');
const db = require('../db');

class TvMetadata extends Metadata {
    constructor() {
        super();
    }

    getImages(serieID) {
        return new Promise((resolve, reject) => {
            fetch(`${this.getAPIUrl()}/tv/${serieID}/images?api_key=${this.getAPIKey()}`)
            .then(res => res.json())
            .then(images => {
                resolve(images);
            })
        });
    }

    async insertSeasonMetadata(metadata, internalSerieID, seasonNumber) {
        return new Promise(async (resolve, reject) => {
            let d = new Date();
            // Insert to the database
            await db.none("INSERT INTO serie_season_metadata (serie_id, season_id, name, air_date, overview, poster_path, added_date) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
                internalSerieID,
                seasonNumber,
                metadata.name,
                metadata.air_date,
                metadata.overview,
                metadata.poster_path,
                `${d.getFullYear()}-${("0" + (d.getMonth() + 1)).slice(-2)}-${("0" + d.getDate()).slice(-2)}` // Added date
            ]);
            resolve();
        });
    }

    async insertEpisodeMetadata(metadata, internalSerieID, seasonNumber, episodeNumber) {
        return new Promise(async (resolve, reject) => {
            let d = new Date();
            if (metadata.still_path == null) {
                console.log(` > Didn't find a image for this episode, using dummyimage.`);
                metadata.still_path = "";
            }

            await db.none("INSERT INTO serie_episode_metadata (air_date, name, overview, image_path, vote_average, episode_number, season_number, serie_id, added_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
                metadata.air_date,
                metadata.name,
                metadata.overview,
                metadata.still_path,
                metadata.vote_average,
                episodeNumber,
                seasonNumber,
                internalSerieID,
                `${d.getFullYear()}-${("0" + (d.getMonth() + 1)).slice(-2)}-${("0" + d.getDate()).slice(-2)}` // Added date
            ]);
            resolve();
        });
    }

    async insertShowMetadata(metadata, images, trailer, internalSerieID) {
        return new Promise(async (resolve, reject) => {
            // If the metadata doesn't have any genre, add one (All series need to have a genre)
            if (metadata.genres.length === 0) {
                metadata.genres.push({
                    id: -1,
                    name: 'other'
                });
            }
            for (let category of metadata.genres) {
                // Check if we already have saved the category from imdb
                let categoryInDb = await db.any('SELECT * FROM category WHERE imdb_category_id = $1 ', [category.id]);
                // If we haven't saved the category from IMDB, save it.
                if (categoryInDb.length === 0) {
                    await db.none('INSERT INTO category (imdb_category_id, name) VALUES ($1, $2)', [category.id, category.name.toLowerCase()])
                }
                // Save the movie category
                await db.none("INSERT INTO serie_category (serie_id, category_id) VALUES ($1, $2)", [internalSerieID, category.id]);
            }

            // SAVE METADATA
            let d = new Date();
            await db.none("INSERT INTO serie_metadata (serie_id, title, overview, first_air_date, popularity, added_date, trailer, tmdb_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
                internalSerieID,
                metadata.original_name,
                metadata.overview,
                metadata.first_air_date,
                metadata.popularity,
                `${d.getFullYear()}-${("0" + (d.getMonth() + 1)).slice(-2)}-${("0" + d.getDate()).slice(-2)}`, // Added date
                "", // Trailer
                metadata.id
            ]);


            // SAVE IMAGES
            // If the movie don't have a image, push one. All the movies need to have a image.
            if (images.backdrops.length === 0) {
                images.backdrops.push({
                    file_path: 'no_image',
                    active: true
                });
            }
            if (images.posters.length === 0) {
                images.posters.push({
                    file_path: 'no_image',
                    active: true
                })
            }
            // TODO: This will push "no_name" to image even if it already exist. That is not needed
            await db.tx(async t => {
                for (let backdrop of images.backdrops) {
                    const imageId = await t.one("INSERT INTO image (path) VALUES($1) RETURNING id", [backdrop.file_path], c => +c.id);
                    t.none("INSERT INTO serie_image (serie_id, image_id, active, type) VALUES ($1, $2, $3, 'BACKDROP')", [internalSerieID, imageId, backdrop.active]);
                }

                // TODO: This will push "no_name" to image even if it already exist. That is not needed.
                for (let poster of images.posters) {
                    const imageId = await t.one("INSERT INTO image (path) VALUES($1) RETURNING id", [poster.file_path], c => +c.id);
                    t.none("INSERT INTO serie_image (serie_id, image_id, active, type) VALUES ($1, $2, $3, 'POSTER')", [internalSerieID, imageId, poster.active]);
                }
                return;
            });
            resolve();
        });
    

    }

    getSeasonMetadata(serieTmdbID, season) {
        return new Promise((resolve, reject) => {
            fetch(`${this.getAPIUrl()}/tv/${serieTmdbID}/season/${season}?api_key=${this.getAPIKey()}&language=en-US`)
            .then(res => res.json())
            .then(json => {
                let result = {
                    metadata: json
                }
                // If we didn't find any metadata
                if (json.status_code != undefined) {
                    result.metadata = null;
                }
                resolve(result);
            });
        });
    }

    getEpisodeMetadata(serieTmdbID, season, episode) {
        return new Promise((resolve, reject) => {
            fetch(`${this.getAPIUrl()}/tv/${serieTmdbID}/season/${season}/episode/${episode}?api_key=${this.getAPIKey()}&language=en-US`)
            .then(res => res.json())
            .then(json => {
                let result = {
                    metadata: json
                };

                // If we didn't find any metadata
                if (json.status_code != undefined) {
                    result.metadata = null;
                }
                resolve(result);
            });
        });
    }

    getShowMetadata(serieName) {
        return new Promise((resolve, reject) => {
            // Search for the show by name
            fetch(`${this.getAPIUrl()}/search/tv?api_key=${this.getAPIKey()}&language=en-US&query=${serieName}&page=1&include_adult=true`)
            .then(res => res.json())
            .then(json => {

                // Get the details for the show
                fetch(`${this.getAPIUrl()}/tv/${json.results[0].id}?api_key=${this.getAPIKey()}&language=en-US`)
                .then(res => res.json())
                .then(metadata => {
                    // Get all the images for the show
                    this.getImages(json.results[0].id)
                    .then(images => {

                        // Set so one backdrop image is active
                        let hasAnActive = false;
                        for (let image of images.backdrops) {
                            if (image.file_path === json.results[0].backdrop_path) {
                                image.active = true;
                                hasAnActive = true;
                            } else {
                                image.active = false;
                            }
                        }
                        if (!hasAnActive) {
                            images.backdrops[0].active = true;
                        }

                        // Set so one poster image is active
                        hasAnActive = false;
                        for (let image of images.posters) {
                            if (image.file_path === json.results[0].poster_path) {
                                image.active = true;
                                hasAnActive = true;
                            } else {
                                image.active = false;
                            }
                        }

                        // Failsafe
                        if (!hasAnActive) {
                            images.posters[0].active = true;
                        }
                        let result = {
                            metadata: metadata,
                            images: images,
                            trailer: null // TODO: Get the trailer
                        }
                        resolve(result);
                    });
                });
            });
        });
    }
}

module.exports = TvMetadata;