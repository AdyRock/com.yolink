'use strict';

/** *******************************************************************************
** YoLink API interface ***
** See http://doc.yosmart.com/docs/protocol/openAPIV2/en.html for details  **
******************************************************************************** */
const
	{
		SimpleClass,
	} = require('homey');

// const fetch = require('node-fetch'); // Only needed for Node.js < 18

const yoLinkApi = {
	cloudUrl: 'https://api-eu.yosmart.com/open/yolink/',
	localUrl: 'http://IP:1080/open/yolink/',
	apiUrl: 'v2/api',
};

module.exports = class YoLinkAPI extends SimpleClass
{
	constructor(app, localIP = null)
	{
		super();
		this.app = app;
		this.baseUrl = localIP ? yoLinkApi.localUrl.replace('IP', localIP) : yoLinkApi.cloudUrl;

		// this.UAIDList is used to store the list of objects {UAID: <UAID>, access_token: <accessToken>, refresh_token: <refreshToken>, expires_at: <expires_at>}
		this.UAIDList = this.app.homey.settings.get('UAIDList') || [];
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
			// Token has expired so get a new one using the refresh token
			const newTokenData = await this.obtainAccessTokenWithRefreshToken(entry.UAID, entry.refresh_token);
			this.app.log(`Access token for UAID ${UAID} has expired`);

			// Update the entry in the UAIDList
			entry.access_token = newTokenData.access_token;
			entry.refresh_token = newTokenData.refresh_token;
			entry.expires_at = Date.now() + (newTokenData.expires_in * 1000);
			this.app.log(`Obtained new access token for UAID ${UAID}, expires at ${new Date(entry.expires_at).toISOString()}`);
			this.app.homey.settings.set('UAIDList', this.UAIDList);
		}
		else if (!entry && SecretKey)
		{
			// No entry found for this UAID, so obtain a new access token using the secret key
			this.app.log(`No entry found for UAID ${UAID}`);
			const newTokenData = await this.obtainAccessTokenWithSecret(UAID, SecretKey);
			this.app.log(`Obtained new access token for UAID ${UAID}, expires at ${new Date(newTokenData.expires_in).toISOString()}`);

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

		return entry ? entry.access_token : null;
	}

	async request(method = 'GET', body = null, headers = {})
	{
		const url = `${this.baseUrl}${yoLinkApi.apiUrl}`;
		this.app.log(`API request: ${method} ${url} ${JSON.stringify(body)}`);
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
		this.app.log(`API response: ${JSON.stringify(data)}`);
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

		const response = await fetch(`${yoLinkApi.cloudUrl}token`, init);
		this.app.log(`response status is ${response.status}`);
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
		this.app.log(data);
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

		const response = await fetch(`${yoLinkApi.cloudUrl}token`, init);
		this.app.log(`response status is ${response.status}`);
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
		this.app.log(data);
		return data;
	}

	async getDeviceList(UAID, SecretKey)
	{
		// Get the access token for the UAID. The SecretKey is only needed if there is no valid access token yet
		const accessToken = await this.getAccessTokenForUAID(UAID, SecretKey);
		if (!accessToken)
		{
			this.app.log(`Failed to obtain access token for UAID ${UAID}`);
			return null;
		}

		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const body = {
			method: 'Home.getDeviceList',
			time: Math.floor(Date.now() / 1000),
		};

		const response = await this.request('POST', body, headers);
		if (response && response.desc === 'Success')
		{
			if (response && response.data && response.data.devices && response.data.devices.length > 0)
			{
				return response.data.devices;
			}

			throw new Error(`No devices found for UAID ${UAID}`);
		}
		else if (response)
		{
			this.app.log(`Failed to obtain device list for UAID ${UAID}: ${response.desc}`);
			throw new Error(`Failed to obtain device list for UAID ${UAID}: ${response.desc}`);
		}

		throw new Error(`Failed to obtain device list for UAID ${UAID}`);
	}

	async getDeviceStatus(UAID, type, deviceId, deviceToken)
	{
		const accessToken = await this.getAccessTokenForUAID(UAID);
		if (!accessToken)
		{
			this.app.log(`Failed to obtain access token for UAID ${UAID}`);
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

		return this.request('POST', body, headers);
	}

	async controlDevice(UAID, deviceId, command)
	{
		const accessToken = await this.getAccessTokenForUAID(UAID);
		if (!accessToken)
		{
			this.app.log(`Failed to obtain access token for UAID ${UAID}`);
			return null;
		}

		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};
		const body = {
			command,
		};

		return this.request(`/devices/${deviceId}/control`, 'POST', body, headers);
	}
};
