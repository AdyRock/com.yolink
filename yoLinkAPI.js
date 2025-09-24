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
		this.MQTTList = []; // List of {UAID, serviceZone, MQTTClient}
	}

	async getUAIDList()
	{
		// Return the array of UAIDs
		return this.UAIDList.map((item) => item.UAID);
	}

	async getAccessTokenForUAID(UAID, SecretKey)
	{
		// Return the accessToken for the given UAID
		let entry = this.UAIDList.find((item) => item.UAID === UAID);
		if (entry && entry.expires_at && entry.expires_at < Date.now())
		{
			// If already fetching a token, wait for it to complete
			if (this.fetchingToken)
			{
				await this.fetchingToken;
			}
			else
			{
				// Set a promise to indicate that we are fetching a token
				let resolveToken;
				this.fetchingToken = new Promise((resolve) =>
				{
					resolveToken = resolve;
				});

				try
				{
					this.app.updateLog(`Access token for UAID ${UAID} has expired`);

					// Token has expired so get a new one using the refresh token
					const newTokenData = await this.obtainAccessTokenWithRefreshToken(entry.UAID, entry.refresh_token);

					// Update the entry in the UAIDList
					entry.access_token = newTokenData.access_token;
					entry.refresh_token = newTokenData.refresh_token;
					entry.expires_at = Date.now() + (newTokenData.expires_in * 1000);
					this.app.updateLog(`Obtained new access token for UAID ${UAID}, expires at ${new Date(entry.expires_at).toISOString()}`);
					this.app.homey.settings.set('UAIDList', this.UAIDList);

					resolveToken();
				}
				catch (error)
				{
					resolveToken(); // Resolve even on error to prevent hanging
					throw error;
				}
				finally
				{
					// Clear the fetchingToken promise
					this.fetchingToken = null;
				}
			}
		}
		else if (!entry && SecretKey)
		{
			// No entry found for this UAID, so obtain a new access token using the secret key
			this.app.updateLog(`No entry found for UAID ${UAID}`);
			const newTokenData = await this.obtainAccessTokenWithSecret(UAID, SecretKey);
			this.app.updateLog(`Obtained new access token for UAID ${UAID}, expires at ${new Date(newTokenData.expires_in).toISOString()}`);

			// Add the new entry to the UAIDList
			entry = {
				UAID,
				access_token: newTokenData.access_token,
				refresh_token: newTokenData.refresh_token,
				expires_at: Date.now() + (newTokenData.expires_in * 1000),
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

	async request(method = 'GET', url, body = null, headers = {})
	{
		this.app.updateLog(`API request: ${method} ${url} ${JSON.stringify(body)}`);
		const options = {
			method,
			headers: {
				'Content-Type': 'application/json',
				...headers,
			},
			body: JSON.stringify(body),
		};

		const response = await fetch(url, options);
		const data = await response.json();
		this.app.updateLog(`API response: ${JSON.stringify(data)}`);
		return data;
	}

	// Obtain access token using UAID and secretKey
	async obtainAccessTokenWithSecret(UAID, secretKey)
	{
		const headers = new Headers();
		headers.append('Content-Type', 'application/x-www-form-urlencoded');

		const body = `grant_type=client_credentials&client_id=${UAID}&client_secret=${secretKey}`;

		const init = {
			method: 'POST',
			headers,
			body,
		};

		const response = await fetch(`${yoLinkApi.cloudUrl_us}token`, init);
		this.app.updateLog(`response status is ${response.status}`);
		const mediaType = response.headers.get('content-type');
		let data;
		if (mediaType.includes('json'))
		{
			data = await response.json();
		}
		else
		{
			data = await response.text();
		}
		this.app.updateLog(data);
		return data;
	}

	async obtainAccessTokenWithRefreshToken(UAID, refreshToken)
	{
		const headers = new Headers();
		headers.append('Content-Type', 'application/x-www-form-urlencoded');

		const body = `grant_type=refresh_token&client_id=${UAID}&refresh_token=${refreshToken}`;

		const init = {
			method: 'POST',
			headers,
			body,
		};

		const response = await fetch(`${yoLinkApi.cloudUrl_us}token`, init);
		this.app.updateLog(`response status is ${response.status}`);
		const mediaType = response.headers.get('content-type');
		let data;
		if (mediaType.includes('json'))
		{
			data = await response.json();
		}
		else
		{
			data = await response.text();
		}
		this.app.updateLog(data);
		return data;
	}

	async getDeviceList(UAID, SecretKey)
	{
		// Get the access token for the UAID. The SecretKey is only needed if there is no valid access token yet
		const accessToken = await this.getAccessTokenForUAID(UAID, SecretKey);
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

		const response = await this.request('POST', `${yoLinkApi.cloudUrl_us}${yoLinkApi.apiUrl}`, body, headers);
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

	getZoneURL(serviceZone)
	{
		if (serviceZone === 'eu_uk')
		{
			return `${yoLinkApi.cloudUrl_eu}${yoLinkApi.apiUrl}`;
		}
		return `${yoLinkApi.cloudUrl_us}${yoLinkApi.apiUrl}`;
	}

	async getDeviceStatus(UAID, type, deviceId, deviceToken, serviceZone)
	{
		const accessToken = await this.getAccessTokenForUAID(UAID);
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

		const url = this.getZoneURL(serviceZone);

		// Ensure an MQTT client is setup for this UAID and serviceZone
		const entry = this.MQTTList.find((item) => (item.UAID === UAID) && (item.serviceZone === serviceZone));
		if (!entry)
		{
			try
			{
				// Setup the MQTT client
				let mqttURL;
				if (serviceZone === 'eu_uk')
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
				};
				const MQTTClient = this.setupMQTTClient(brokerConfig);
				if (MQTTClient)
				{
					this.MQTTList.push({ UAID, serviceZone, MQTTClient });
				}
			}
			catch (err)
			{
				this.app.updateLog(`Failed to setup MQTT client for UAID ${UAID}: ${err.message}`, 0);
			}
		}

		return this.request('POST', url, body, headers);
	}

	async controlDevice(UAID, deviceId, deviceToken, serviceZone, command, params = {})
	{
		const accessToken = await this.getAccessTokenForUAID(UAID);
		if (!accessToken)
		{
			this.app.updateLog(`Failed to obtain access token for UAID ${UAID}`, 0);
			return null;
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

		const url = this.getZoneURL(serviceZone);
		return this.request('POST', url, body, headers);
	}

	async getHomeInfo(UAID)
	{
		const accessToken = await this.getAccessTokenForUAID(UAID);
		if (!accessToken)
		{
			this.app.updateLog(`Failed to obtain access token for UAID ${UAID}`, 0);
			return null;
		}

		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const body = {
			method: 'Home.getGeneralInfo',
			time: Math.floor(Date.now() / 1000),
		};

		return this.request('POST', `${yoLinkApi.cloudUrl_us}${yoLinkApi.apiUrl}`, body, headers);
	}

	setupMQTTClient(brokerConfig)
	{
		try
		{
			// Connect to the MQTT server and subscribe to the state change topic
			this.app.updateLog(`setupMQTTClient connect: ${brokerConfig.url}:${brokerConfig.port}`, 1);
			const MQTTclient = mqtt.connect(`${brokerConfig.url}:${brokerConfig.port}`, { clientId: `HomeyYoLinkApp-${this.app.homeyID}`, username: brokerConfig.username, password: brokerConfig.password });

			MQTTclient.on('connect', async () =>
			{
				this.app.updateLog(`setupMQTTClient.onConnect: connected to ${brokerConfig.url}:${brokerConfig.port} as ${brokerConfig.UAID}`);

				// Subscribe to the yl-home/HomeID/+/report topic to receive device reports
				const homeID = await this.getHomeInfo(brokerConfig.UAID);
				const topic = `yl-home/${homeID.data.id}/+/report`;
				MQTTclient.subscribe(topic, { qos: 0 }, (err) =>
				{
					if (err)
					{
						this.app.updateLog(`setupMQTTClient.subscribe error: ${this.app.varToString(err)}`, 0);
					}
				});
			});

			MQTTclient.on('error', (err) =>
			{
				this.app.updateLog(`setupMQTTClient.onError: ${this.app.varToString(err)}`, 0);
			});

			MQTTclient.on('message', async (topic, message) =>
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

					const drivers = this.app.homey.drivers.getDrivers();
					for (const driver of Object.values(drivers))
					{
						const devices = driver.getDevices();
						for (const device of Object.values(devices))
						{
							if (device.processMQTTMessage)
							{
								await device.processMQTTMessage(mqttMessage).catch(device.error);
							}
						}
					}
				}
				catch (err)
				{
					this.app.updateLog(`MQTT Client error: ${topic}: ${err.message}`, 0);
				}
			});

			return MQTTclient;
		}
		catch (err)
		{
			this.app.updateLog(`setupMQTTClient error: ${err.message}`, 0);
			return null;
		}
	}
};
