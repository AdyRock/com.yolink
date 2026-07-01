'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class MotionSensorDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'MotionSensor';
		this.homey.app.updateLog('MotionSensorDriver has been initialized');
	}

	getIcon(modelNumber)
	{
		// the motion sensor has different icons for different models that are stored in the root/assest folder
		// remove the '-' suffix if present
		if (modelNumber.includes('-'))
		{
			modelNumber = modelNumber.split('-')[0];
		}
		switch (modelNumber)
		{
		case 'YS7805':
			return 'YS7805.svg';
		case 'YS7804':
			return 'YS7804.svg';
		case 'YS7806':
			return 'YS7805.svg';
		default:
			return 'YS7804.svg';
		}
	}

};
