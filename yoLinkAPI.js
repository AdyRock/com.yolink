/* eslint-disable operator-linebreak */
/* eslint-disable no-tabs */

'use strict';

/** *******************************************************************************
** YoLink API interface ***
** See http://doc.yosmart.com/docs/protocol/openAPIV2/en.html for details  **
******************************************************************************** */
const
	{
		SimpleClass,
	} = require('homey');

const mqtt = require('./mqtt');

// const fetch = require('node-fetch'); // Only needed for Node.js < 18

const yoLinkApi = {
	cloudUrl_us: 'https://api.yosmart.com/open/yolink/',
	cloudUrl_eu: 'https://api-eu.yosmart.com/open/yolink/',
	mqttUrl_us: 'mqtt://api.yosmart.com',
	mqttUrl_eu: 'mqtt://api-eu.yosmart.com',
	localUrl: 'http://IP:1080/open/yolink/',
	apiUrl: 'v2/api',
};

module.exports = class YoLinkAPI extends SimpleClass
{
	constructor(app)
	{
		super();
		this.app = app;

		// this.UAIDList is used to store the list of objects {UAID: <UAID>, access_token: <accessToken>, refresh_token: <refreshToken>, expires_at: <expires_at>}
		this.UAIDList = this.app.homey.settings.get('UAIDList') || [];
		this.MQTTList = []; // List of {UAID, serviceZoneID, MQTTClient}
		this.tokenRefreshPromises = {}; // Keyed by UAID
		this.mqttSetupPromises = {}; // Keyed by UAID_serviceZoneID
	}

	async getUAIDList()
	{
		// Return the array of UAIDs
		return this.UAIDList.map((item) => item.UAID);
	}

	formatDateForLog(value)
	{
		const date = new Date(value);
		return Number.isFinite(date.getTime()) ? date.toISOString() : `invalid date (${String(value)})`;
	}

	safeJsonStringify(value)
	{
		try
		{
			return JSON.stringify(value);
		}
		catch (error)
		{
			return `unserializable value: ${error.message}`;
		}
	}

	getServiceZoneID(serviceZone)
	{
		if (typeof serviceZone !== 'string' || serviceZone.length < 2)
		{
			return 'us';
		}
		return serviceZone.substring(0, 2).toLowerCase();
	}

	getSafeExpiresAt(expiresInSeconds, UAID)
	{
		const fallbackSeconds = 300;
		const maxSeconds = 30 * 24 * 60 * 60;
		const parsed = Number(expiresInSeconds);

		if (!Number.isFinite(parsed) || parsed <= 0)
		{
			this.app.updateLog(`Invalid expires_in for UAID ${UAID}: ${this.app.varToString(expiresInSeconds)}. Using fallback ${fallbackSeconds}s`, 0);
			return Date.now() + (fallbackSeconds * 1000);
		}

		const safeSeconds = Math.min(parsed, maxSeconds);
		return Date.now() + (safeSeconds * 1000);
	}

	isAccessTokenExpired(expiresAt)
	{
		const parsed = Number(expiresAt);
		if (!Number.isFinite(parsed))
		{
			return true;
		}

		// Refresh slightly early to avoid edge-case expiry during a request.
		const refreshSkewMs = 30 * 1000;
		return parsed <= (Date.now() + refreshSkewMs);
	}

	async getAccessTokenForUAID(UAID, SecretKey, serviceZone)
	{
		const serviceZoneID = this.getServiceZoneID(serviceZone);

		// Return the accessToken for the given UAID
		let entry = this.UAIDList.find((item) => item.UAID === UAID);
		if (entry && this.isAccessTokenExpired(entry.expires_at))
		{
			const refreshPromise = this.tokenRefreshPromises[UAID] || (async () =>
			{
				this.app.updateLog(`Access token for UAID ${UAID} has expired`);

				const currentEntry = this.UAIDList.find((item) => item.UAID === UAID);
				if (!currentEntry)
				{
					throw new Error(`No token entry found for UAID ${UAID} during refresh`);
				}

				// Token has expired so get a new one using the refresh token
				const newTokenData = await this.obtainAccessTokenWithRefreshToken(currentEntry.UAID, currentEntry.refresh_token, serviceZoneID);
				if (!newTokenData || newTokenData.state === 'error' || !newTokenData.access_token)
				{
					throw new Error(`Failed to refresh access token for UAID ${UAID}: ${newTokenData && newTokenData.msg ? newTokenData.msg : 'Unknown error'}`);
				}

				this.app.updateLog(`New token data for UAID ${UAID}: ${this.app.varToString(newTokenData)}`);

				// Update the entry in the UAIDList
				currentEntry.access_token = newTokenData.access_token;
				currentEntry.refresh_token = newTokenData.refresh_token;
				currentEntry.expires_at = this.getSafeExpiresAt(newTokenData.expires_in, UAID);
				this.app.updateLog(`Obtained new access token for UAID ${UAID}, expires at ${this.formatDateForLog(currentEntry.expires_at)}, ${currentEntry.access_token}`);
				this.app.homey.settings.set('UAIDList', this.UAIDList);
				this.refreshMQTTClientsForUAID(UAID);
			})();

			if (!this.tokenRefreshPromises[UAID])
			{
				this.tokenRefreshPromises[UAID] = refreshPromise;
			}

			try
			{
				await refreshPromise;
			}
			finally
			{
				if (this.tokenRefreshPromises[UAID] === refreshPromise)
				{
					delete this.tokenRefreshPromises[UAID];
				}
			}

			entry = this.UAIDList.find((item) => item.UAID === UAID);
		}
		else if (!entry && SecretKey)
		{
			// No entry found for this UAID, so obtain a new access token using the secret key
			this.app.updateLog(`No entry found for UAID ${UAID}`);
			const newTokenData = await this.obtainAccessTokenWithSecret(UAID, SecretKey, serviceZoneID);
			if (newTokenData.state === 'error')
			{
				this.app.updateLog(`Failed to obtain access token for UAID ${UAID}: ${newTokenData.msg}`, 0);
				// return null;
				throw new Error(`Failed to obtain access token for UAID ${UAID}: ${newTokenData.msg}`);
			}
			this.app.updateLog(`New token data for UAID ${UAID}: ${this.app.varToString(newTokenData)}`);
			this.app.updateLog(`Obtained new access token for UAID ${UAID}, expires at ${this.formatDateForLog(Date.now() + (newTokenData.expires_in * 1000))}`);

			// Add the new entry to the UAIDList
			entry = {
				UAID,
				access_token: newTokenData.access_token,
				refresh_token: newTokenData.refresh_token,
				expires_at: this.getSafeExpiresAt(newTokenData.expires_in, UAID),
			};
			this.UAIDList.push(entry);
			this.app.homey.settings.set('UAIDList', this.UAIDList);
		}

		// if (entry && !this.MQTTClient)
		// {
		// 	try
		// 	{
		// 		// Setup the MQTT client
		// 		const brokerConfig = {
		// 			UAID,
		// 			url: 'mqtt://api-eu.yosmart.com',
		// 			port: 8003,
		// 			username: entry.access_token,
		// 			password: '',
		// 		};
		// 		this.MQTTClient = this.setupMQTTClient(brokerConfig);
		// 	}
		// 	catch (err)
		// 	{
		// 		this.app.updateLog(`Failed to setup MQTT client for UAID ${UAID}: ${err.message}`, 0);
		// 	}
		// }

		return entry ? entry.access_token : null;
	}

	refreshMQTTClientsForUAID(UAID)
	{
		if (!this.MQTTList || this.MQTTList.length === 0)
		{
			return;
		}

		const mqttConnections = this.MQTTList.filter((item) => item.UAID === UAID && item.MQTTClient);
		for (const connection of mqttConnections)
		{
			const accessTokenEntry = this.UAIDList.find((item) => item.UAID === UAID);
			if (!accessTokenEntry || !accessTokenEntry.access_token)
			{
				continue;
			}

			const { serviceZoneID } = connection;
			const brokerConfig = {
				UAID,
				url: serviceZoneID === 'eu' ? yoLinkApi.mqttUrl_eu : yoLinkApi.mqttUrl_us,
				port: 8003,
				username: accessTokenEntry.access_token,
				password: '',
				serviceZoneID,
			};

			this.app.updateLog(`Refreshing MQTT client for UAID ${UAID} and serviceZoneID ${serviceZoneID} after token refresh`);
			connection.MQTTClient.end(true);
			this.setupMQTTClient(brokerConfig).then((mqttConnection) =>
			{
				if (!mqttConnection)
				{
					return;
				}

				const index = this.MQTTList.findIndex((item) => item.UAID === UAID && item.serviceZoneID === serviceZoneID);
				if (index >= 0)
				{
					this.MQTTList[index] = mqttConnection;
				}
				else
				{
					this.MQTTList.push(mqttConnection);
				}
			}).catch((error) =>
			{
				this.app.updateLog(`Failed to refresh MQTT client for UAID ${UAID} and serviceZoneID ${serviceZoneID}: ${error.message}`, 0);
			});
		}
	}

	getTokenURL(serviceZoneID)
	{
		if (serviceZoneID === 'eu')
		{
			return `${yoLinkApi.cloudUrl_eu}token`;
		}
		return `${yoLinkApi.cloudUrl_us}token`;
	}

	async request(method = 'GET', url, body = null, headers = {})
	{
		this.app.updateLog(`API request: ${method} ${url} ${this.safeJsonStringify(body)}`);
		const options = {
			method,
			headers: {
				'Content-Type': 'application/json',
				...headers,
			},
			body: body === null ? null : this.safeJsonStringify(body),
		};

		try
		{
			const response = await fetch(url, options);
			const data = await response.json();
			this.app.updateLog(`API response: ${JSON.stringify(data)}`);
			return data;
		}
		catch (error)
		{
			this.app.updateLog(`API request failed: ${error.message}`, 0);
			return { state: 'error', msg: error.message };
		}
	}

	// Obtain access token using UAID and secretKey
	async obtainAccessTokenWithSecret(UAID, secretKey, serviceZoneID = 'us')
	{
		const headers = new Headers();
		headers.append('Content-Type', 'application/x-www-form-urlencoded');

		const body = `grant_type=client_credentials&client_id=${UAID}&client_secret=${secretKey}`;

		const init = {
			method: 'POST',
			headers,
			body,
		};

		try
		{
			const response = await fetch(this.getTokenURL(serviceZoneID), init);
			this.app.updateLog(`response status is ${response.status}`);
			const mediaType = response.headers.get('content-type');
			let data;
			if (mediaType && mediaType.includes('json'))
			{
				data = await response.json();
			}
			else
			{
				data = await response.text();
			}
			this.app.updateLog(this.app.varToString(data));
			return data;
		}
		catch (error)
		{
			this.app.updateLog(`Failed to obtain access token with secret for UAID ${UAID}: ${error.message}`, 0);
			return { state: 'error', msg: error.message };
		}
	}

	async obtainAccessTokenWithRefreshToken(UAID, refreshToken, serviceZoneID = 'us')
	{
		const headers = new Headers();
		headers.append('Content-Type', 'application/x-www-form-urlencoded');

		const body = `grant_type=refresh_token&client_id=${UAID}&refresh_token=${refreshToken}`;

		const init = {
			method: 'POST',
			headers,
			body,
		};

		try
		{
			const response = await fetch(this.getTokenURL(serviceZoneID), init);
			this.app.updateLog(`response status is ${response.status}`);
			const mediaType = response.headers.get('content-type');
			let data;
			if (mediaType && mediaType.includes('json'))
			{
				data = await response.json();
			}
			else
			{
				data = await response.text();
			}
			this.app.updateLog(this.app.varToString(data));
			return data;
		}
		catch (error)
		{
			this.app.updateLog(`Failed to obtain access token with refresh token for UAID ${UAID}: ${error.message}`, 0);
			return { state: 'error', msg: error.message };
		}
	}

	async getDeviceList(UAID, SecretKey, serviceZone)
	{
		// Get the access token for the UAID. The SecretKey is only needed if there is no valid access token yet
		let accessToken = null;
		try
		{
			accessToken = await this.getAccessTokenForUAID(UAID, SecretKey, serviceZone);
		}
		catch (error)
		{
			this.app.updateLog(`Failed to obtain access token for UAID ${UAID}: ${error.message}`, 0);
			return null;
		}

		if (!accessToken)
		{
			this.app.updateLog(`Failed to obtain access token for UAID ${UAID}`, 0);
			return null;
		}

		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const body = {
			method: 'Home.getDeviceList',
			time: Math.floor(Date.now() / 1000),
		};

		const serviceZoneID = this.getServiceZoneID(serviceZone);
		const response = await this.request('POST', this.getZoneURL(serviceZoneID), body, headers);
		if (response && response.desc === 'Success')
		{
			if (response && response.data && response.data.devices && response.data.devices.length > 0)
			{
				this.lastDeviceList = response.data.devices;
				return response.data.devices;
			}

			throw new Error(`No devices found for UAID ${UAID}`);
		}
		else if (response)
		{
			this.app.updateLog(`Failed to obtain device list for UAID ${UAID}: ${response.desc}`);
			throw new Error(`Failed to obtain device list for UAID ${UAID}: ${response.desc}`);
		}

		throw new Error(`Failed to obtain device list for UAID ${UAID}`);
	}

	getZoneURL(serviceZoneID)
	{
		if (serviceZoneID === 'eu')
		{
			return `${yoLinkApi.cloudUrl_eu}${yoLinkApi.apiUrl}`;
		}
		return `${yoLinkApi.cloudUrl_us}${yoLinkApi.apiUrl}`;
	}

	async getDeviceStatus(UAID, type, deviceId, deviceToken, serviceZone)
	{
		let accessToken = null;
		try
		{
			accessToken = await this.getAccessTokenForUAID(UAID, null, serviceZone);
		}
		catch (error)
		{
			this.app.updateLog(`Failed to obtain access token for UAID ${UAID}: ${error.message}`, 0);
			return null;
		}

		if (!accessToken)
		{
			this.app.updateLog(`Failed to obtain access token for UAID ${UAID}`, 0);
			return null;
		}

		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const body = {
			method: `${type}.getState`,
			time: Math.floor(Date.now() / 1000),
			targetDevice: deviceId,
			token: deviceToken,
			params: {},
		};

		// Get the service zone ID, which is the first two characters of the serviceZone string
		const serviceZoneID = this.getServiceZoneID(serviceZone);
		const url = this.getZoneURL(serviceZoneID);

		const setupKey = `${UAID}_${serviceZoneID}`;
		while (this.mqttSetupPromises[setupKey])
		{
			this.app.updateLog(`Waiting for MQTT client setup to complete for UAID ${UAID} and serviceZoneID ${serviceZoneID}`);
			await this.mqttSetupPromises[setupKey];
		}

		const setupPromise = (async () =>
		{
			const retryKey = `${UAID}_${serviceZoneID}`;
			if (this.mqttRetryTimers && this.mqttRetryTimers[retryKey])
			{
				// A retry timer exists for this UAID/serviceZoneID, so don't try setting up MQTT client now
				this.app.updateLog(`Skipping wait for MQTT client setup for UAID ${UAID} and serviceZoneID ${serviceZoneID} as a retry timer exists`);
				return;
			}

			// Ensure an MQTT client is setup for this UAID and serviceZoneID
			const entry = this.MQTTList.find((item) => (item.UAID === UAID) && (item.serviceZoneID === serviceZoneID));
			if (!entry)
			{
				try
				{
					this.app.updateLog(`MQTT client for UAID ${UAID} and serviceZoneID ${serviceZoneID} not found, setting up now`);

					// Setup the MQTT client
					let mqttURL;
					if (serviceZoneID === 'eu')
					{
						mqttURL = yoLinkApi.mqttUrl_eu;
					}
					else
					{
						mqttURL = yoLinkApi.mqttUrl_us;
					}

					const brokerConfig = {
						UAID,
						url: mqttURL,
						port: 8003,
						username: accessToken,
						password: '',
						serviceZoneID,
					};
					const MQTTConnection = await this.setupMQTTClient(brokerConfig);
					if (MQTTConnection)
					{
						this.MQTTList.push(MQTTConnection);
						this.app.updateLog(`MQTT client setup complete for UAID ${UAID}. Number of MQTT clients: ${this.MQTTList.length}`);
					}
				}
				catch (err)
				{
					this.app.updateLog(`Failed to setup MQTT client for UAID ${UAID}: ${err.message}`, 0);
				}
			}
			else
			{
				this.app.updateLog(`MQTT client already setup for UAID ${UAID} and serviceZoneID ${serviceZoneID}`);
			}
		})();

		this.mqttSetupPromises[setupKey] = setupPromise;
		try
		{
			await setupPromise;
		}
		finally
		{
			if (this.mqttSetupPromises[setupKey] === setupPromise)
			{
				delete this.mqttSetupPromises[setupKey];
			}
		}

		return this.request('POST', url, body, headers);
	}

	async controlDevice(UAID, deviceId, deviceToken, serviceZone, command, params = {})
	{
		let accessToken = null;
		try
		{
			accessToken = await this.getAccessTokenForUAID(UAID, null, serviceZone);
		}
		catch (error)
		{
			this.app.updateLog(`Failed to obtain access token for UAID ${UAID}: ${error.message}`, 0);
			return { desc: `Failed to obtain access token for UAID ${UAID}` };
		}

		if (!accessToken)
		{
			this.app.updateLog(`Failed to obtain access token for UAID ${UAID}`, 0);
			return { desc: `Failed to obtain access token for UAID ${UAID}` };
		}

		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};
		const body = {
			method: command,
			time: Math.floor(Date.now() / 1000),
			targetDevice: deviceId,
			token: deviceToken,
			params,
		};

		// Get the service zone ID, which is the first two characters of the serviceZone string
		const serviceZoneID = this.getServiceZoneID(serviceZone);
		const url = this.getZoneURL(serviceZoneID);
		return this.request('POST', url, body, headers);
	}

	async getHomeInfo(UAID, serviceZone)
	{
		let accessToken = null;
		try
		{
			accessToken = await this.getAccessTokenForUAID(UAID, null, serviceZone);
		}
		catch (error)
		{
			this.app.updateLog(`Failed to obtain access token for UAID ${UAID}: ${error.message}`, 0);
			return { desc: `Failed to obtain access token for UAID ${UAID}` };
		}

		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const body = {
			method: 'Home.getGeneralInfo',
			time: Math.floor(Date.now() / 1000),
		};

		const serviceZoneID = this.getServiceZoneID(serviceZone);
		return this.request('POST', this.getZoneURL(serviceZoneID), body, headers);
	}

	async postMQTTMessage(mqttMessage)
	{
		this.app.updateLog(`postMQTTMessage: ${this.app.varToString(mqttMessage)}`);

		// Find the MQTT client for the UAID/service zone when available.
		let requestedServiceZoneID = null;
		if (typeof mqttMessage.serviceZoneID === 'string' && mqttMessage.serviceZoneID.length >= 2)
		{
			requestedServiceZoneID = mqttMessage.serviceZoneID.substring(0, 2).toLowerCase();
		}
		else if (typeof mqttMessage.serviceZone === 'string' && mqttMessage.serviceZone.length >= 2)
		{
			requestedServiceZoneID = this.getServiceZoneID(mqttMessage.serviceZone);
		}

		const entry = requestedServiceZoneID
			? this.MQTTList.find((item) => item.UAID === mqttMessage.UAID && item.serviceZoneID === requestedServiceZoneID)
			: this.MQTTList.find((item) => item.UAID === mqttMessage.UAID);
		if (entry && entry.MQTTClient)
		{
			// wait for the MQTT client is ready
			await entry.mqttReady;

			// Publish the message to the yl-home/HomeID/deviceId/command topic
			const topic = `yl-home/${entry.homeID}/**/request`;
			entry.MQTTClient.publish(topic, JSON.stringify(mqttMessage.command), { qos: 0 }, (err) =>
			{
				if (err)
				{
					this.app.updateLog(`postMQTTMessage.publish error: ${this.app.varToString(err)}`, 0);
				}
				else
				{
					this.app.updateLog(`postMQTTMessage.publish: published to ${topic}`, 1);
				}
			});
		}
	}

	async setupMQTTClient(brokerConfig, retryCount = 0, maxRetries = 3)
	{
		try
		{
			let readyToken;
			const mqttReady = new Promise((resolve) =>
			{
				readyToken = resolve;
			});

			// Connect to the MQTT server and subscribe to the state change topic
			const homeID = await this.getHomeInfo(brokerConfig.UAID, brokerConfig.serviceZoneID);
			if (!homeID || !homeID.data || !homeID.data.id)
			{
				this.app.updateLog(`Failed to get home info for UAID ${brokerConfig.UAID}: ${homeID || 'No response'}`, 0);
				return null;
			}
			const rndID = Math.floor(Math.random() * 100000);
			this.app.updateLog(`setupMQTTClient connect: ${brokerConfig.url}:${brokerConfig.port}, { clientId: HomeyYoLinkApp-${this.app.homeyID}-${rndID}, username: ${brokerConfig.username}, password: ${brokerConfig.password} }`, 1);
			const MQTTClient = mqtt.connect(`${brokerConfig.url}:${brokerConfig.port}`, { clientId: `HomeyYoLinkApp-${this.app.homeyID}-${rndID}`, username: brokerConfig.username, password: brokerConfig.password });
			let connectionFailed = false;

			MQTTClient.on('connect', () =>
			{
				this.app.updateLog(`setupMQTTClient.onConnect: connected to ${brokerConfig.url}:${brokerConfig.port} as ${brokerConfig.UAID}`);

				// Subscribe to the yl-home/HomeID/+/report topic to receive device reports
				this.app.updateLog(`setupMQTTClient.onConnect: homeID is ${this.app.varToString(homeID)}`);
				const topic = `yl-home/${homeID.data.id}/+/report`;
				MQTTClient.subscribe(topic, { qos: 0 }, (err) =>
				{
					if (err)
					{
						this.app.updateLog(`setupMQTTClient.subscribe error: ${this.app.varToString(err)}`, 0);
					}
					else
					{
						this.app.updateLog(`setupMQTTClient.subscribe: subscribed to ${topic}`, 1);
					}
				});

				const topicResponse = `yl-home/${homeID.data.id}/+/response`;
				MQTTClient.subscribe(topicResponse, { qos: 0 }, (err) =>
				{
					if (err)
					{
						this.app.updateLog(`setupMQTTClient.subscribe error: ${this.app.varToString(err)}`, 0);
					}
					else
					{
						this.app.updateLog(`setupMQTTClient.subscribe: subscribed to ${topicResponse}`, 1);
					}

					readyToken();
				});
			});

			MQTTClient.on('error', (err) =>
			{
				this.app.updateLog(`setupMQTTClient.onError: ${this.app.varToString(err)} when connecting to ${brokerConfig.url}:${brokerConfig.port}, HomeyYoLinkApp-${this.app.homeyID}-${rndID}, ${brokerConfig.username}, ${brokerConfig.password}`, 0);

				// Stop reconnection attempts for authentication errors
				if (err.code === 'ECONNREFUSED' ||
					err.message.includes('Connection refused') ||
					err.message.includes('Not authorized') ||
					err.message.includes('Authentication failed'))
				{
					this.app.updateLog('Authentication error detected, stopping MQTT reconnection attempts', 0);
					connectionFailed = true;
					MQTTClient.end(true); // Force close the connection
					readyToken();
				}
			});

			MQTTClient.on('close', () =>
			{
				this.app.updateLog(`MQTT connection closed for UAID ${brokerConfig.UAID}`);
				// Remove this client from the MQTTList when connection is closed
				this.MQTTList = this.MQTTList.filter((item) => item.UAID !== brokerConfig.UAID || item.serviceZoneID !== brokerConfig.serviceZoneID);
			});

			MQTTClient.on('message', async (topic, message) =>
			{
				// message is in Buffer
				try
				{
					let mqttMessage = '';
					const mqttString = message.toString();
					try
					{
						mqttMessage = JSON.parse(mqttString);
					}
					catch (err)
					{
						mqttMessage = mqttString;
					}

					this.app.updateLog(`MQTTclient.on message: ${topic}, ${this.app.varToString(mqttMessage)}`);
					let deviceFound = false;

					const drivers = this.app.homey.drivers.getDrivers();
					for (const driver of Object.values(drivers))
					{
						const devices = driver.getDevices();
						for (const device of Object.values(devices))
						{
							if (device.processMQTTMessage)
							{
								if (await device.processMQTTMessage(mqttMessage).catch(device.error))
								{
									deviceFound = true;
									break;
								}
							}
						}
						if (deviceFound)
						{
							break;
						}
					}

					if (!deviceFound)
					{
						this.app.updateLog(`No device found to process MQTT message for topic ${topic}`);
					}
				}
				catch (err)
				{
					this.app.updateLog(`MQTT Client error: ${topic}: ${err.message}`, 0);
				}
			});

			// Wait for the MQTT client to be ready
			this.app.updateLog('setupMQTTClient: waiting for MQTT client to be ready');
			await mqttReady;

			// Return null if connection failed
			if (connectionFailed)
			{
				// Schedule retry on any other error if we haven't exceeded max retries
				if (retryCount < maxRetries)
				{
					this.app.updateLog('Scheduling MQTT reconnection attempt due to error...', 1);
					this.scheduleMQTTRetry(brokerConfig, retryCount + 1, maxRetries);
				}

				return null;
			}

			return { UAID: brokerConfig.UAID, homeID: homeID.data.id, serviceZoneID: brokerConfig.serviceZoneID, mqttReady, MQTTClient };
		}
		catch (err)
		{
			this.app.updateLog(`setupMQTTClient error: ${err.message}`, 0);
			return null;
		}
	}

	scheduleMQTTRetry(brokerConfig, retryCount, maxRetries)
	{
		// Clear any existing retry timer for this UAID/serviceZoneID
		const retryKey = `${brokerConfig.UAID}_${brokerConfig.serviceZoneID}`;
		if (this.mqttRetryTimers && this.mqttRetryTimers[retryKey])
		{
			clearTimeout(this.mqttRetryTimers[retryKey]);
		}

		// Initialize retry timers object if it doesn't exist
		if (!this.mqttRetryTimers)
		{
			this.mqttRetryTimers = {};
		}

		// Calculate retry delay (exponential backoff: 60s, 120s, 240s)
		const retryDelay = 60000 * (2 ** (retryCount - 1));

		this.mqttRetryTimers[retryKey] = setTimeout(async () =>
		{
			try
			{
				this.app.updateLog(`Attempting MQTT reconnection for UAID ${brokerConfig.UAID} (attempt ${retryCount}/${maxRetries})`);

				// Get a fresh access token
				const newAccessToken = await this.getAccessTokenForUAID(brokerConfig.UAID, null, brokerConfig.serviceZoneID);
				if (!newAccessToken)
				{
					this.app.updateLog(`Failed to get new access token for UAID ${brokerConfig.UAID}, retry aborted`, 0);
					return;
				}

				// Update the broker config with the new access token
				const newBrokerConfig = {
					...brokerConfig,
					username: newAccessToken,
				};

				// Attempt to setup MQTT client again
				const MQTTConnection = await this.setupMQTTClient(newBrokerConfig, retryCount, maxRetries);
				if (MQTTConnection)
				{
					// Find and update existing entry in MQTTList or add new one
					const existingIndex = this.MQTTList.findIndex((item) => item.UAID === brokerConfig.UAID && item.serviceZoneID === brokerConfig.serviceZoneID);

					if (existingIndex >= 0)
					{
						this.MQTTList[existingIndex] = MQTTConnection;
					}
					else
					{
						this.MQTTList.push(MQTTConnection);
					}

					this.app.updateLog(`MQTT client reconnection successful for UAID ${brokerConfig.UAID}`, 1);
				}
			}
			catch (err)
			{
				this.app.updateLog(`MQTT retry attempt failed for UAID ${brokerConfig.UAID}: ${err.message}`, 0);
			}
			finally
			{
				// Clean up the timer reference
				delete this.mqttRetryTimers[retryKey];
			}
		}, retryDelay);

		this.app.updateLog(`MQTT retry scheduled for UAID ${brokerConfig.UAID} in ${retryDelay / 1000} seconds`, 1);
	}
};
