/* eslint-disable no-tabs */
/* eslint-disable no-nested-ternary */
/* jslint node: true */

'use strict';

const Homey = require('homey');
/**
 * Base class for drivers
 * @class
 * @extends {Homey.Driver}
 */

module.exports = class yoLinkDriver extends Homey.Driver
{

	async onPair(session)
	{
		const UAIDList = await this.homey.app.yoLinkAPI.getUAIDList();
		let accessToken = null;
		let UAID = null;
		let secretKey = null;

		session.setHandler('showView', async (view) =>
		{
			if (view === 'enter_secret')
			{
				if (UAID && accessToken)
				{
					// We have both UAID and accessToken so we can skip the enter_secret view
					await session.nextView();
				}
			}
		});

		session.setHandler('select_uaid_setup', async () =>
		{
			// Return the list of UAIDs to populate the dropdown
			return UAIDList;
		});

		session.setHandler('select_uaid', async (data) =>
		{
			UAID = data.uaid;
			if (UAID)
			{
				accessToken = await this.homey.app.yoLinkAPI.getAccessTokenForUAID(UAID, null);
			}

			// return true to continue so the secret can be entered if the access token could not be obtained
			await session.nextView();
			return true;
		});

		session.setHandler('enter_secret', async (data) =>
		{
			secretKey = data.secret;
			accessToken = await this.homey.app.yoLinkAPI.getAccessTokenForUAID(UAID, secretKey);

			if (!accessToken)
			{
				await session.nextView();
				return true;
			}
			return false;
		});

		session.setHandler('list_devices', async () =>
		{
			this.log('list_devices');
			if (!accessToken)
			{
				throw new Error('No access token, cannot list devices');
			}
			const deviceList = await this.homey.app.yoLinkAPI.getDeviceList(UAID, accessToken);
			if (!deviceList)
			{
				throw new Error('No devices found');
			}

			// Filter the list to just include devices of this type
			const filteredList = deviceList.filter((device) => device.type === this.deviceType);
			return filteredList.map((device) => ({
				name: device.name,
				data:
				{
					id: device.deviceId,
					deviceUDID: device.deviceUDID,
					deviceToken: device.token,
					parentDeviceId: device.parentDeviceId,
					UAID,
					type: device.type,
				},
			}));
		});
	}

	async onRepair(session, device)
	{
		let UAID = this.homey.settings.get('UAID');
		let secretKey = this.homey.settings.get('secretKey');

		session.setHandler('login', async (data) =>
		{
			UAID = data.UAID;
			secretKey = data.secretKey;
			const credentialsAreValid = await this.homey.app.newLogin_2(UAID, secretKey);

			// return true to continue adding the device if the login succeeded
			// return false to indicate to the user the login attempt failed
			// thrown errors will also be shown to the user
			return credentialsAreValid;
		});
	}

	async getState(data)
	{
		return this.homey.app.yoLinkAPI.getDeviceStatus(data.UAID, data.type, data.id, data.deviceToken);
	}
};
