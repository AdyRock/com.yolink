'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class SpeakerHubDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'SpeakerHub';

		this.homey.flow.getActionCard('play_tone')
			.registerRunListener(async (args, state) =>
			{
				const data = await args.device.getData();
				const settings = await args.device.getSettings();
				return this.homey.app.yoLinkAPI.controlDevice(data.UAID, data.id, data.deviceToken, settings.serviceZone, 'SpeakerHub.playAudio', { tone: args.tone, volume: args.volume, repeat: parseInt(args.repeat, 10) });
			});

		this.homey.flow.getActionCard('play_message')
			.registerRunListener(async (args, state) =>
			{
				const data = await args.device.getData();
				const settings = await args.device.getSettings();
				return this.homey.app.yoLinkAPI.controlDevice(data.UAID, data.id, data.deviceToken, settings.serviceZone, 'SpeakerHub.playAudio', { message: args.message, volume: args.volume, repeat: parseInt(args.repeat, 10) });
			});

		this.homey.app.updateLog('SpeakerHubDriver has been initialized');
	}

};
