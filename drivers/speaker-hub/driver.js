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
		this.homey.app.updateLog('SpeakerHubDriver has been initialized');
	}

};
