'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class MyDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'SpeakerHub';
		this.log('MyDriver has been initialized');
	}

};
