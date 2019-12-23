"use strict";

const Promise = require("pinkie-promise");
const queryString = require("querystring");
const fetch = require("node-fetch");
const objectAssign = require("object-assign");
const nodeUrl = require("url");
const electron = require("electron");
const session = electron.session;
const BrowserWindow = electron.BrowserWindow;

var generateRandomString = function(length) {
    var text = "";
    var possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
};

module.exports = function(config, windowParams) {
    function getAuthorizationCode(opts, callback) {
        opts = opts || {};

        if (!config.redirectUri) {
            config.redirectUri = "urn:ietf:wg:oauth:2.0:oob";
        }

        var urlParams = {
            response_type: "code",
            redirect_uri: config.redirectUri,
            client_id: config.clientId,
            state: generateRandomString(16)
        };

        if (opts.scope) {
            urlParams.scope = opts.scope;
        }

        if (opts.accessType) {
            urlParams.access_type = opts.accessType;
        }

        var url = config.authorizationUrl + "?" + queryString.stringify(urlParams);

        const authWindow = new BrowserWindow(
            windowParams || { "use-content-size": true }
        );

        authWindow.loadURL(url);
        authWindow.show();

        authWindow.on("closed", function() {
            callback(new Error("window was closed by user"));
        });

        function onCallback(url) {
            var url_parts = nodeUrl.parse(url, true);
            var query = url_parts.query;
            var code = query.code;
            var error = query.error;

            if (error !== undefined) {
                callback(error);
                authWindow.removeAllListeners("closed");
                setImmediate(function() {
                    setTimeout(function() {
                        authWindow.webContents.session.clearStorageData({
                                storages: ["appcache", "cookies", "filesystem", "shadercache"],
                                quotas: ["persistent", "syncable"]
                            },
                            function() {
                                authWindow.close();
                                authWindow.destroy();
                            }
                        );
                    }, 100);
                });
            } else if (code) {
                callback(code);
                authWindow.removeAllListeners("closed");
                setImmediate(function() {
                    setTimeout(function() {
                        authWindow.webContents.session.clearStorageData({
                                storages: ["appcache", "cookies", "filesystem", "shadercache"],
                                quotas: ["persistent", "syncable"]
                            },
                            function() {
                                authWindow.close();
                                authWindow.destroy();
                            }
                        );
                    }, 100);
                });
            }
        }

        authWindow.webContents.on("will-navigate", function(event, url) {
            onCallback(url);
        });
        var filter = {
            urls: [config.redirectUri + "*"]
        };
        authWindow.webContents.session.webRequest.onBeforeRequest(
            filter,
            (details, c) => {
                var url = details.url;
                if (url.startsWith(config.redirectUri)) {
                    onCallback(url);
                }
                c({});
            }
        );
        authWindow.webContents.on("did-get-redirect-request", function(
            event,
            oldUrl,
            newUrl
        ) {
            onCallback(newUrl);
        });
    }

    function tokenRequest(data, callback) {
        const header = {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
        };

        if (config.useBasicAuthorizationHeader) {
            header.Authorization =
                "Basic " +
                new Buffer(config.clientId + ":" + config.clientSecret).toString(
                    "base64"
                );
        } else {
            objectAssign(data, {
                client_id: config.clientId,
                client_secret: config.clientSecret
            });
        }

        fetch(config.tokenUrl, {
            method: "POST",
            headers: header,
            body: queryString.stringify(data)
        }).then(response => response.json()).then(function(data) {

            callback(data);
            // return res.json();
        });
    }

    function getAccessToken(opts) {
        return new Promise(function(resolve, reject) {
            getAuthorizationCode(opts, function(authorizationCode) {
                var tokenRequestData = {
                    code: authorizationCode,
                    grant_type: "authorization_code",
                    redirect_uri: config.redirectUri
                };
                tokenRequestData = Object.assign(
                    tokenRequestData,
                    opts.additionalTokenRequestData
                );
                tokenRequest(tokenRequestData, function(resp) {
                    resolve(resp);
                });
            });
        });
    }

    function refreshToken(refreshToken, callback) {
        tokenRequest({
                refresh_token: refreshToken,
                grant_type: "refresh_token",
                redirect_uri: config.redirectUri
            },
            function(resp) {
                callback(resp);
            }
        );
    }

    return {
        getAuthorizationCode: getAuthorizationCode,
        getAccessToken: getAccessToken,
        refreshToken: refreshToken
    };
};
